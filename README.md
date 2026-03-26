# Claude Mission Control

> Terminal multiplexer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).
> See everything Claude does in real time — agents, thinking, tools, files — each in its own panel.

```
 Claude Mission Control  |  ● 2 agents  |  46 tools  |  2 files  |  hooks
 1:Think | 2:Tools | 3:Files | 4:Orch | 5:Web
┌─Claude Code─────────────────────────────────────┐┌─Thinking────────────────────┐
│                                                  ││                             │
│  Claude Code v2.1.84                             ││  ⟳ Herding... [medium]      │
│  Welcome back!                                   ││    14:30:45                  │
│                                                  ││  ⟳ Bootstrapping... [medium] │
│  ● Searching for 2 patterns, reading 1 file...   ││    14:30:48                  │
│                                                  ││  ✓ Done (41s)               │
│  Here is my analysis of the codebase:            ││                             │
│  ...                                             ││                             │
│                                                  ││                             │
├─Agent (Explore)──────┬─Agent (coder11111)────────┤│                             │
│  ✓ Found 15 modules  │  ⟳ Writing new module...  ││                             │
│  ✓ Mapped 3 layers   │  → src/utils/helper.ts    ││                             │
│                      │                           ││                             │
└──────────────────────┴───────────────────────────┘└─────────────────────────────┘
 ● passthrough
```

## What it does

Claude Code runs in a single terminal. Agents, thinking, tool calls, file edits — everything is interleaved in one stream. You have to scroll back and piece together what happened.

**Mission Control** wraps Claude Code and splits the output into panels:

| Panel | What it shows |
|---|---|
| **Main** | Full Claude Code terminal (real VT100 emulation) |
| **Agents** | Sub-agent output, appears automatically when agents spawn |
| **Thinking** | Reasoning indicators with timestamps and effort level |
| **Tools** | Tool calls with status (pending / success / error) |
| **Files** | Real-time file changes detected via filesystem watcher |
| **Orchestrator** | Agent tree, tool feed, session stats |
| **Browser** | Fetch and display web pages as text |

Panels appear and disappear automatically. Agents get their own panes when they spawn. The right column has 5 tabs you can switch between.

## Quick start

```bash
git clone https://github.com/axeliparrea/claude-code-mission-control.git
cd claude-code-mission-control
npm install
npm run build
npm link
```

Then from **any project**:

```bash
cd ~/my-project
cmc
```

That's it. Claude Code launches inside Mission Control. Type normally — your input goes straight to Claude.

## Usage

```bash
# From any project directory (after npm link)
cd ~/my-project
cmc

# Point to a specific project
cmc --cwd ~/another-project

# Without npm link
node /path/to/claude-code-mission-control/dist/index.js

# Development mode (with hot reload)
cd claude-code-mission-control
npm run dev
```

## Keyboard shortcuts

Mission Control has two modes:

### Passthrough mode (default)

Everything you type goes directly to Claude Code. It's like a normal terminal.

| Key | Action |
|---|---|
| `Esc` | Enter panel mode |
| `Ctrl+C` x1 | Sent to Claude Code (normal behavior) |
| `Ctrl+C` x2 | Quit Mission Control (double tap fast) |

### Panel mode (press Esc)

Navigate panels, scroll content, switch tabs.

| Key | Action |
|---|---|
| `1` - `5` | Switch right panel tab (Think/Tools/Files/Orch/Web) |
| `Tab` | Cycle focus between panes |
| `Up` / `Down` | Scroll focused pane |
| `q` | Quit Mission Control |
| `Esc` | Back to passthrough mode |

### Right panel tabs

| Tab | Key | Content |
|---|---|---|
| Think | `1` | Thinking indicators with timestamps |
| Tools | `2` | Tool calls with success/error status |
| Files | `3` | File changes (add/modify/delete) |
| Orch | `4` | Agent tree, tool feed, session stats |
| Web | `5` | Web page viewer (fetch URLs as text) |

## Platform-specific install notes

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

## Project memory

Mission Control remembers context for each project across sessions. Data is stored in `.mc/` inside your project:

```
your-project/
  .mc/
    memory/
      entries.json       # Architecture decisions, patterns, notes
      tracked-files.json # Important files with reasons
    sessions/
      abc123.json        # Summary of each MC session
    CONTEXT.md           # Auto-generated context (injected on start)
```

Every time you close MC, it saves: tools used, agents spawned, files changed, thinking topics. Next time you open MC in that project, it loads the history.

## How it works

```
Your terminal
|
+-- node-pty spawns `claude` in a pseudo-terminal
|
+-- Raw PTY output feeds:
|   +-- @xterm/headless (full VT100 emulation for main pane)
|   +-- Parser (classifies lines -> thinking / agent / tools / files)
|
+-- Hook system (IPC via unix sockets):
|   +-- MC injects hooks into Claude Code settings on start
|   +-- Claude Code runs hook-forward.mjs on each tool call
|   +-- Structured JSON (tool name, agent type, success/error)
|
+-- chokidar watches working directory -> files panel
|
+-- Screen buffer renders all panes with diff-based updates (~30fps)
    Only changed cells are redrawn each frame
```

Claude Code doesn't know it's being wrapped. It sees a normal terminal.

## Layout

The layout adapts based on how many agents are active:

**0 agents** — Main pane takes the full left column.

**1 agent** — Main pane shrinks, agent pane appears below.

**2 agents** — Two agent panes split the bottom half.

**Small terminal** (< 100 cols) — Compact mode, main pane only.

## Testing

```bash
npm test              # 243 unit/integration tests
npm run test:e2e      # 16 end-to-end tests (headless PTY)
npm run test:smoke    # 9 module import verification tests
npm run test:all      # Everything above

npm run sandbox       # Interactive testing with mock Claude Code
```

## Tech stack

| Component | Technology | Purpose |
|---|---|---|
| Terminal emulation | @xterm/headless | Full VT100 for main pane |
| Pseudo-terminal | node-pty | Spawn Claude Code cross-platform |
| File watching | chokidar | Detect file changes in real time |
| Rendering | Custom screen buffer | Cell-based diff rendering to stdout |
| IPC | node:net unix sockets | Receive hook events from Claude Code |
| Build | tsup | Bundle to single JS file |
| Tests | vitest | Fast TypeScript-native testing |

No TUI framework. Raw ANSI escape codes + custom terminal compositor.

## Requirements

- **Node.js 22+**
- **Claude Code** installed and in PATH (`claude`)
- Terminal with 256-color support
- Minimum 100 columns x 25 rows

## License

MIT
