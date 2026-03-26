# Technical Documentation

Deep dive into the architecture, tech stack, and internals of Claude Mission Control.

## Tech Stack

| Component | Technology | Version | Why |
|---|---|---|---|
| Language | TypeScript | 5.7+ | Strict mode, discriminated unions, exhaustive checks |
| Runtime | Node.js | 22+ | ESM native, stable `node:net` for IPC |
| Terminal Emulation | @xterm/headless | 5.5+ | Full VT100/xterm in a headless Node.js environment — no DOM needed |
| Pseudo-terminal | node-pty | 1.0+ | Cross-platform PTY: Unix PTY (Linux/macOS) + ConPTY (Windows) |
| File Watching | chokidar | 4.0+ | FSEvents (macOS), inotify (Linux), ReadDirectoryChangesW (Windows) |
| ANSI Parsing | Custom (`ansi.ts`) | — | Converts ANSI SGR sequences to typed cell arrays for rendering |
| Rendering | Custom (`screen.ts`) | — | Cell-based diff renderer — only changed cells emit escape codes |
| Dev Runner | tsx | 4.0+ | Runs TypeScript directly without compiling |
| Bundler | tsup | 8.0+ | Bundles to single ESM file for distribution |
| Tests | vitest | 2.1+ | Fast, TypeScript-native, 227 tests |

### Why no TUI framework?

We evaluated blessed, ink, and similar frameworks. None fit because:

1. **We need real terminal emulation** — the MAIN pane runs a full VT100 terminal (cursor positioning, colors, scrollback). TUI frameworks render text boxes, not terminals.
2. **We need cell-level control** — diff-based rendering requires tracking individual cells across frames. TUI frameworks abstract this away.
3. **We need raw ANSI passthrough** — Claude Code outputs complex ANSI sequences. We preserve them in the main pane via xterm headless rather than stripping and re-rendering.

The architecture is a **terminal compositor**: multiple virtual terminals composed onto a single real terminal, like a window manager for the command line.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CLAUDE MISSION CONTROL                         │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ PTY Manager │  │ Hook Server  │  │ File Watcher             │   │
│  │ (node-pty)  │  │ (net.Server) │  │ (chokidar)               │   │
│  │             │  │              │  │                          │   │
│  │ Spawns      │  │ Receives     │  │ Detects                  │   │
│  │ `claude`    │  │ JSON via IPC │  │ file changes             │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────────┘   │
│         │                │                      │                   │
│    raw bytes        HookEvent            FileChangeEvent            │
│         │                │                      │                   │
│         ├────────────────┼──────────────────────┘                   │
│         │                │                                          │
│         ▼                ▼                                          │
│  ┌─────────────┐  ┌─────────────┐                                  │
│  │ xterm       │  │ Parser      │                                  │
│  │ headless    │  │ Pipeline    │                                  │
│  │             │  │             │                                  │
│  │ VT100 state │  │ Classifies: │                                  │
│  │ for MAIN    │  │ thinking    │                                  │
│  │ pane        │  │ agent       │                                  │
│  │             │  │ mcp/tool    │                                  │
│  │             │  │ file edit   │                                  │
│  │             │  │ error       │                                  │
│  └──────┬──────┘  └──────┬──────┘                                  │
│         │                │                                          │
│         ▼                ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    PANEL ROUTER                               │   │
│  │          Routes chunks to the correct pane                    │   │
│  └──────────────────────────┬───────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼         ▼          ▼         ▼          ▼                 │
│  ┌───────────┬──────────┬──────────┬────────┬──────────┐           │
│  │   MAIN    │ AGENT-N  │ THINKING │ TOOLS  │  FILES   │           │
│  │ Terminal  │ TextPane │ TextPane │TextPane│ TextPane │           │
│  │  Pane     │          │          │        │          │           │
│  └───────────┴──────────┴──────────┴────────┴──────────┘           │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    SCREEN BUFFER                              │   │
│  │           Cell grid with diff-based ANSI output               │   │
│  │           Only changed cells are flushed to stdout            │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Module Map

```
src/
├── index.ts                    Entry point, lifecycle orchestration
├── types.ts                    All shared types and interfaces
├── theme.ts                    Color palette, ANSI helpers, icons
│
├── core rendering
│   ├── ansi.ts                 ANSI SGR parser → Cell arrays
│   ├── screen.ts               2D cell buffer with diff-based flush
│   ├── terminal-pane.ts        VT100 pane (xterm/headless wrapper)
│   └── text-pane.ts            Ring-buffer text pane with scroll
│
├── layout
│   └── layout.ts               State machine: solo/single/dual/compact
│
├── parser
│   └── parser.ts               Line buffer + regex matchers pipeline
│
├── hooks/
│   ├── hook-server.ts          Unix socket IPC server
│   ├── hook-forward.js         Script executed by Claude Code hooks
│   └── hook-installer.ts       Inject/remove hooks in Claude Code settings
│
└── watchers/
    └── file-watcher.ts         chokidar wrapper with dedup
```

## Data Flow

### 1. PTY → Main Pane (VT100)

```
node-pty spawns `claude`
        │
        ▼
   raw bytes from PTY
        │
        ├──► xterm headless Terminal.write(data)
        │    └── full VT100 state machine: cursor, colors, scrollback
        │
        └──► Parser.feed(data)
             └── line buffer → regex matchers → ParsedChunk[]
                 └── routeChunk() → side panes
```

The main pane gets the raw PTY data through xterm headless. This means it handles ALL terminal sequences correctly: cursor positioning, alternate screen buffer, colors, bold/italic/underline, mouse events — everything Claude Code outputs renders perfectly.

### 2. Hooks → Structured Events

```
Claude Code calls a tool
        │
        ▼
   PreToolUse hook fires
        │
        ▼
   Claude Code executes: node hook-forward.js PreToolUse
   (receives tool data as JSON on stdin)
        │
        ▼
   hook-forward.js connects to Unix socket
   sends: {"hookType":"PreToolUse","timestamp":...,"payload":{...}}
        │
        ▼
   HookServer.handleConnection()
        │
        ▼
   parseHookMessage() → convertToHookEvent()
        │
        ▼
   HookEvent dispatched to callbacks
        │
        ▼
   routeHookEvent() → appropriate pane
```

Hook events provide **structured data** that PTY parsing can't reliably extract:
- Exact tool name and input/output
- Agent type, model, and prompt
- Success/failure status
- Confidence scores from agent output

### 3. File Watcher → Files Pane

```
chokidar watches CWD
        │
        ├── add event    → FileChangeEvent { changeType: 'A', filePath: relative }
        ├── change event → FileChangeEvent { changeType: 'M', filePath: relative }
        └── unlink event → FileChangeEvent { changeType: 'D', filePath: relative }
                │
                ▼
         Dedup filter (500ms window per file+op)
                │
                ▼
         filesPane.appendLine()
```

Ignored paths: `node_modules/`, `.git/`, `dist/`, `*.lock`, `.DS_Store`

### 4. Rendering Pipeline

```
Any pane content changes
        │
        ▼
   pane.renderTo(screen)
   ├── drawBox() — border with title
   └── for each visible line:
       └── writeAnsiString() or put() — cells into 2D grid
        │
        ▼
   screen.flush(process.stdout)
   ├── compare current cells vs previous frame
   ├── for each changed cell:
   │   └── emit: cursor-move + SGR-color + character
   └── skip unchanged cells entirely
```

The diff-based renderer means a frame with 1 changed cell emits ~10 bytes instead of redrawing the entire screen (~20KB for a 200x50 terminal).

## Rendering Architecture

### Cell Model

```typescript
interface Cell {
  char: string;          // single character
  fg: string;            // ANSI SGR foreground (e.g. "\x1b[38;2;88;166;255m")
  bg: string;            // ANSI SGR background
  attrs: number;         // bitmask: BOLD | DIM | ITALIC | UNDERLINE | INVERSE
}
```

### ScreenBuffer

Two grids: `current` (being built) and `previous` (last flushed). On `flush()`:

```
for each (row, col):
  if current[row][col] !== previous[row][col]:
    emit cursor-position + style + character
```

Cursor movement is optimized: if the next changed cell is adjacent, no cursor-move is emitted.

### Frame Budget (33ms @ ~30fps)

```
Pane content updates:  ~2ms  (ring buffer append)
Screen buffer build:   ~3ms  (renderTo for each pane)
Diff calculation:      ~2ms  (cell comparison)
stdout write:          ~3ms  (escape sequences)
Overhead:              ~2ms  (event loop, GC)
────────────────────────────
Total:                ~12ms  (21ms margin)
```

### Terminal Pane vs Text Pane

| | TerminalPane | TextPane |
|---|---|---|
| Backing | @xterm/headless Terminal | string[] ring buffer |
| Rendering | Read xterm cell buffer → screen cells | ANSI string → screen cells |
| Scroll | xterm scrollback | Manual offset tracking |
| Use case | MAIN (full VT100) | THINKING, TOOLS, FILES, AGENTS |
| Content | Raw PTY passthrough | Classified text lines |

## Hook System

### IPC Protocol

- Transport: Unix domain socket (Linux/macOS) or Named Pipe (Windows)
- Path: `/tmp/mission-control-{sessionId}.sock`
- Protocol: one JSON message per connection, newline-terminated
- Lifecycle: connect → write JSON + `\n` → close

### Hook Installation

On startup:
1. Read `.claude/settings.local.json`
2. Backup to `.claude/settings.local.json.mc-backup`
3. Append MC hook entries to `hooks.PreToolUse`, `hooks.PostToolUse`, `hooks.Stop`
4. Write lock file `/tmp/mission-control-{pid}.lock`

On shutdown:
1. Restore settings from backup
2. Remove lock file and socket file

Crash recovery:
1. On startup, scan `/tmp/mission-control-*.lock`
2. If PID is dead → restore backup, clean up

### Hook Event Types

```typescript
type HookEvent =
  | { type: 'tool_start'; toolName; toolInput; serverName; timestamp }
  | { type: 'tool_end'; toolName; toolOutput; toolSuccess; timestamp }
  | { type: 'agent_spawn'; agentType; agentPrompt; agentModel; timestamp }
  | { type: 'agent_done'; agentOutput; confidence; timestamp }
  | { type: 'stop'; timestamp }
```

Conversion rules:
- `PreToolUse` where `tool_name === 'Agent'` → `agent_spawn`
- `PostToolUse` where `tool_name === 'Agent'` → `agent_done`
- `PreToolUse` (other) → `tool_start`
- `PostToolUse` (other) → `tool_end`
- `Stop` → `stop`

## Layout Engine

### State Machine

```
States:
  SOLO    — 0 agents: main takes full left column
  SINGLE  — 1 agent: main 55% top, agent 45% bottom
  DUAL    — 2 agents: main 45% top, agents split bottom
  COMPACT — terminal < 100 cols or < 25 rows

Transitions:
  SOLO   → SINGLE  : agent spawns
  SINGLE → DUAL    : second agent spawns
  DUAL   → SINGLE  : one agent finishes (slot freed by new agent)
  SINGLE → SOLO    : last agent finishes
  ANY    → COMPACT : terminal too small
```

### Layout Dimensions

```
┌── header (row 0, full width) ───────────────────────────────────────┐
│                                                                      │
│  LEFT COLUMN (65%)                    RIGHT COLUMN (35%)             │
│  ┌────────────────────┐              ┌────────────────────┐         │
│  │ MAIN               │              │ THINKING (1/3)     │         │
│  │                    │              ├────────────────────┤         │
│  ├────────────────────┤              │ TOOLS (1/3)        │         │
│  │ AGENT-1 | AGENT-2  │              ├────────────────────┤         │
│  │                    │              │ FILES (1/3)        │         │
│  └────────────────────┘              └────────────────────┘         │
│                                                                      │
├── input bar (last row, left column width) ──────────────────────────┤
└─────────────────────────────────────────────────────────────────────┘
```

Right column minimum: 30 columns. Below that → compact mode.

### Agent Overflow

Max 2 visible agent panes. When a 3rd agent spawns:
1. Find oldest agent with status `done`
2. Evict it (remove pane)
3. Create new pane in freed slot
4. If no evictable agent → new agent is dropped

## Parser Pipeline

### Matcher Priority (top to bottom)

```
1. Thinking (stateful)  — enters on: ⚡ Thinking, thinking..., extended thinking
                          exits on: tool call, agent spawn, file edit
2. Agent spawn          — Spawned agent, Running agent:, Agent X started
3. Agent done           — agent done/complete/finished/returned
4. Tool use             — Tool: X, ⏳ Read/Write/Edit/Bash/...
5. Tool result          — ✓ X.Y, ✗ X
6. File edit            — Modified/Created/Deleted/Wrote: path
7. Error                — Error:, ✗, FAIL, panic:, fatal:
8. Default              — everything else → MAIN
```

Lines are stripped of ANSI for matching but the original (with ANSI) is preserved for display.

## Cross-Platform

| | Linux | macOS | Windows |
|---|---|---|---|
| PTY | Unix PTY (forkpty) | Unix PTY (forkpty) | ConPTY (Win10+) |
| IPC | Unix socket | Unix socket | Named pipe |
| Line endings | LF | LF | CRLF → normalized to LF |
| File watcher | inotify | FSEvents | ReadDirectoryChangesW |
| Resize | SIGWINCH | SIGWINCH | stdout poll (500ms) |
| Minimum OS | Kernel 4.x+ | Monterey 12+ | Win 10 v1809+ |

## Test Architecture

```
test/
├── Unit tests (pure functions)
│   ├── ansi.test.ts          39 tests — ANSI parsing
│   ├── parser.test.ts        47 tests — line classification
│   ├── layout.test.ts        35 tests — layout calculation
│   ├── screen.test.ts        34 tests — cell buffer + diff
│   └── text-pane.test.ts     30 tests — ring buffer + scroll
│
├── Component tests (I/O)
│   ├── hook-server.test.ts   10 tests — IPC socket lifecycle
│   ├── hook-installer.test.ts 9 tests — settings read/write
│   └── file-watcher.test.ts  10 tests — chokidar integration
│
├── Integration tests
│   └── mcp/
│       ├── integration.test.ts  8 tests — full pipeline
│       └── hook-flow.test.ts    5 tests — hook lifecycle
│
└── Sandbox (manual testing)
    └── sandbox/
        ├── run.sh              launcher script
        └── mock-claude.ts      mock CLI with test scenarios
```

Total: **227 tests**, all passing.

## Performance

### Memory

```
Node.js + @xterm/headless + node-pty:  ~30-50MB base
Ring buffers (6 panes):                 ~600KB
chokidar:                              ~5-10MB
Hook server:                           ~2MB
────────────────────────────────────────
Total:                                 ~50-70MB
```

### Ring Buffer Sizes

| Pane | Max Lines | Rationale |
|---|---|---|
| MAIN | xterm scrollback (1000) | User scrolls here most |
| AGENT | 500 | Agent output can be verbose |
| TOOLS | 300 | Tool calls accumulate over a session |
| THINKING | 200 | High volume, low scroll-back value |
| FILES | 50 | Deduplicated, rarely exceeds this |

## Error Handling

| Scenario | Behavior |
|---|---|
| `claude` not in PATH | Error in MAIN pane |
| node-pty build fails | postinstall gives platform instructions |
| PTY crashes | "[process exited: N]" in MAIN, auto-exit after 1.5s |
| Terminal too small | Compact layout (single pane, no sidebar) |
| Hook IPC fails | Hooks disabled, PTY-only mode, "hooks:off" in header |
| File watcher fails | Files pane stays empty, rest works normally |
| Malformed hook JSON | Silently dropped, no crash |
| Stale lock file | Crash recovery on startup, restore backup |
| Unknown PTY line | Goes to MAIN (safe default, nothing is lost) |
