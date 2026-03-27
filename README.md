<p align="center">
  <h1 align="center">Claude Mission Control</h1>
  <p align="center">
    <strong>The terminal multiplexer for Claude Code</strong><br>
    See everything your AI does — agents, thinking, tools, files — in real time.
  </p>
  <p align="center">
    <a href="#quick-start">Quick Start</a> ·
    <a href="#features">Features</a> ·
    <a href="#keyboard-shortcuts">Shortcuts</a> ·
    <a href="#project-memory">Memory</a> ·
    <a href="#how-it-works">Architecture</a>
  </p>
  <p align="center">
    <img src="https://img.shields.io/badge/tests-300%20passing-brightgreen" alt="300 tests passing">
    <img src="https://img.shields.io/badge/node-%3E%3D22-blue" alt="Node 22+">
    <img src="https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey" alt="Cross-platform">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
    <img src="https://img.shields.io/badge/TUI-no%20framework-orange" alt="No TUI framework">
  </p>
</p>

---

```
 Claude Mission Control  |  ● 2 agents  |  46 tools  |  hooks    1:Think | 2:Tools | 3:Files | 4:Orch | 5:Web
┌─Claude Code─────────────────────────────────────┐ ┌─Thinking──────────────────────┐
│                                                  │ │                               │
│  Welcome back!                                   │ │  ⟳ Herding... [medium] 14:30  │
│                                                  │ │  ⟳ Bootstrapping...    14:30  │
│  ● Launching 3 agents to explore this repo...    │ │  ✓ Done (41s)                 │
│                                                  │ │                               │
│  Here is my analysis:                            │ │                               │
│  The project uses a modular architecture with    │ │                               │
│  15 modules across 3 layers...                   │ │                               │
│                                                  │ │                               │
├─Explore: root config────┬─coder: implement───────┤ │                               │
│  ✓ Read package.json    │  ⟳ Edit src/index.ts   │ │                               │
│  ✓ Glob **/*.ts         │  ⟳ Write src/helper.ts │ │                               │
│  ✓ Found 15 modules     │  → Creating module...  │ │                               │
└─────────────────────────┴────────────────────────┘ └───────────────────────────────┘
 ● passthrough
```

## Why Mission Control?

Claude Code runs in a single terminal. When it spawns agents, reasons through problems, calls tools, or edits files — **everything is interleaved in one stream**. You have to scroll back and piece together what happened.

Mission Control wraps Claude Code and gives you **X-ray vision** into everything it does:

| Problem | Solution |
|---|---|
| Can't see what agents are doing | Each agent gets its own live pane |
| Thinking is hidden/mixed in output | Dedicated Thinking tab with timestamps |
| Tool calls flash by unnoticed | Tools tab shows every call with status |
| File changes are hard to track | Files tab + real-time filesystem watcher |
| Context lost between sessions | Persistent project memory with error lessons |
| No idea what happened last session | Auto-generated session reports with agent report cards |

### By the Numbers

| Metric | Value |
|---|---|
| Test coverage | **300 tests** across 14 suites |
| Startup time | **< 1 second** |
| Memory footprint | **~50-70 MB** |
| Render rate | **~30 fps** diff-based |
| Dependencies | **4 runtime** (node-pty, xterm, chokidar, strip-ansi) |
| Framework | **None** — raw ANSI + custom compositor |

## Features

### Real-Time Agent Visibility

Every sub-agent gets its own pane. See what each one is doing — tool calls, file edits, output — as it happens. Agent panes appear automatically when agents spawn and show completion status.

```
┌─Explore: frontend──────┬─coder11111: implement──┐
│  ✓ Read package.json   │  ⟳ Edit src/index.ts   │
│  ✓ Glob **/*.tsx       │  + src/utils/helper.ts  │
│  Found 42 components   │  M src/types.ts         │
│  React + Next.js       │  Running tests...       │
└────────────────────────┴─────────────────────────┘
```

### 5-Tab Side Panel

Switch between views with number keys `1`-`5` in panel mode:

| Tab | Key | Shows |
|---|---|---|
| **Think** | `1` | Thinking indicators with verb, effort level, duration |
| **Tools** | `2` | Every tool call with status, input preview, MCP server name |
| **Files** | `3` | File changes (create/modify/delete) from parser + filesystem watcher |
| **Orch** | `4` | Agent tree, tool feed, session statistics |
| **Web** | `5` | Fetch and display web pages as terminal text |

### Smart MCP Tool Display

When Claude Code uses MCP servers, MC auto-switches to the Tools tab and shows rich detail:

```
⟳ slack:send_message [slack-mcp] 14:30:45
  → {"channel": "#general", "text": "Deploy complete"}
✓ slack:send_message [slack-mcp] 14:30:47
  → Message sent successfully

⟳ browser:navigate [puppeteer-mcp] 14:31:02
  → {"url": "https://api.example.com/health"}
✓ browser:navigate [puppeteer-mcp] 14:31:05
  → 200 OK
```

### Persistent Project Memory

MC remembers everything about each project — across sessions, automatically:

```
your-project/.mc/
├── memory/
│   ├── entries.json          # Architecture, decisions, tech stack
│   └── tracked-files.json    # Important files with reasons
├── sessions/
│   └── abc123.json           # Full session report
└── CONTEXT.md                # Auto-injected into Claude on startup
```

**What it captures:**
- Tech stack auto-detected from file extensions
- File change history with operations (A/M/D)
- Agent report cards with success/fail status
- Error lessons accumulated across sessions
- Conversation topics and decisions

### Agent Report Cards

Every session saves a detailed report for each agent:

```
Agents: 3 total (2 success, 1 failed)
  #1 Explore [OK] (12 tools)
     Task: Analyze project architecture
     Files: M package.json, A src/util.ts
     Result: Found 15 modules across 3 layers
  #2 coder11111 [OK] (8 tools)
     Task: Implement helper module
     Files: A src/helper.ts, M src/index.ts
     Result: Module created with 3 exports
  #3 qa [FAIL] (5 tools)
     Task: Run test suite
     Errors: EACCES: permission denied /tmp/test.db
```

### Error Learning

Errors are accumulated across sessions and injected as context in future sessions, so Claude learns from past mistakes:

```
Errors to learn from (3):
- [coder11111] EACCES: permission denied /tmp/test.db
- [session] TypeError: cannot read property 'map' of undefined
- [qa] Test timeout: async operation took > 5000ms
```

## Quick Start

```bash
# Clone and install
git clone https://github.com/axeliparrea/claude-code-mission-control.git
cd claude-code-mission-control
npm install
npm run build
npm link

# Now use from ANY project
cd ~/my-project
cmc
```

That's it. Claude Code launches inside Mission Control.

### Alternative usage

```bash
# Point to a specific project
cmc --cwd ~/another-project

# Without npm link
node /path/to/claude-code-mission-control/dist/index.js

# Development mode (hot reload)
cd claude-code-mission-control
npm run dev
```

### Platform notes

If `node-pty` fails to compile:

```bash
# macOS
xcode-select --install && npm rebuild node-pty

# Debian / Ubuntu
sudo apt install build-essential python3 && npm rebuild node-pty

# Arch Linux
sudo pacman -S base-devel python && npm rebuild node-pty

# Windows (requires Windows Terminal, Win 10 v1809+)
npm install -g windows-build-tools && npm rebuild node-pty
```

## Keyboard Shortcuts

### Passthrough mode (default)

Everything you type goes directly to Claude Code.

| Key | Action |
|---|---|
| `Esc` | Enter panel mode |
| `Ctrl+C` x1 | Sent to Claude Code |
| `Ctrl+C` x2 | Quit Mission Control |

### Panel mode (press Esc)

| Key | Action |
|---|---|
| `1`-`5` | Switch right panel tab |
| `Tab` | Cycle focus between panes |
| `↑` / `↓` | Scroll focused pane |
| `q` | Quit |
| `Esc` | Back to passthrough |

## How It Works

```
Your terminal
│
├── node-pty spawns `claude` in a pseudo-terminal
│
├── Raw PTY output feeds:
│   ├── @xterm/headless (full VT100 emulation → main pane)
│   └── Parser (classifies lines → thinking/agent/tools/files)
│         └── Routes to agent panes when agents are active
│
├── Hook system (IPC via unix sockets):
│   ├── MC injects hooks into Claude Code settings on start
│   ├── Claude Code runs hook-forward.mjs on each tool call
│   └── Structured data: tool name, agent type, success/error
│
├── chokidar watches project directory → files panel
│   └── Respects .gitignore patterns
│
├── Project memory (.mc/):
│   ├── Auto-detects tech stack from file extensions
│   ├── Saves session reports with agent report cards
│   ├── Accumulates error lessons across sessions
│   └── Writes CONTEXT.md injected on next startup
│
└── Screen buffer renders all panes (~30fps diff-based)
    Only changed cells are redrawn each frame
```

Claude Code doesn't know it's being wrapped. It sees a normal terminal.

## Responsive Layout

| Terminal size | Layout |
|---|---|
| **120+ cols** | Full layout: main + agents + tabbed side panel (35%) |
| **80-120 cols** | Narrow right panel (28%) |
| **60-80 cols** | Compact right panel (30 cols minimum) |
| **< 60 cols** | Main pane only, no side panel |

Agent panes get minimum 5 rows. Layout recalculates instantly on resize.

## Testing

```bash
npm test              # 300 unit/integration tests
npm run test:e2e      # 16 end-to-end tests (headless PTY)
npm run test:smoke    # 9 module verification tests
npm run test:all      # Everything

npm run sandbox       # Interactive testing with mock Claude
```

### Test coverage by module

| Module | Tests | What's tested |
|---|---|---|
| Parser | 63 | Line classification, agent detection, thinking, tools, files |
| Layout | 35 | All states, resize, compact mode, agent panes |
| Screen | 34 | Cell buffer, diff rendering, resize, ANSI |
| Text pane | 30 | Ring buffer, scroll, ANSI rendering |
| ANSI | 39 | Color parsing, attributes, edge cases |
| Hook server | 10 | IPC socket, event routing, malformed JSON |
| Hook installer | 9 | Install/uninstall, backup, idempotency |
| File watcher | 10 | Add/modify/delete, ignore, dedup |
| Session collector | 41 | Agent reports, errors, files, tech detection |
| Agent routing | 16 | Spawn formats, lifecycle, hook integration |
| Integration | 13 | Full pipeline, persistence, hook flow |

## Tech Stack

| Component | Technology | Purpose |
|---|---|---|
| Terminal emulation | @xterm/headless | Full VT100 for main pane |
| Pseudo-terminal | node-pty | Spawn Claude Code cross-platform |
| File watching | chokidar | Real-time file change detection |
| Rendering | Custom compositor | Cell-based diff rendering |
| IPC | node:net unix sockets | Hook event communication |
| Build | tsup | Single-file JS bundle |
| Tests | vitest | 300 tests, ~8s total |
| Language | TypeScript strict | Full type safety |

**No TUI framework.** Raw ANSI escape codes + custom terminal compositor.

## Requirements

- **Node.js 22+**
- **Claude Code** installed and in PATH
- Terminal with 256-color support
- Minimum 60 columns x 15 rows

## Contributing

```bash
# Development
npm run dev           # Run with tsx (hot reload)
npm run typecheck     # Check types
npm test              # Run tests
npm run sandbox       # Test with mock Claude

# Build
npm run build         # Compile to dist/
```

## License

MIT
