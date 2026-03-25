# Claude Mission Control

Terminal multiplexer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — real-time visibility into agents, thinking, tools, and file changes.

```
┌──────── Claude Mission Control ─── ● 2 agents ─────────┐
│                              │                          │
│  MAIN terminal               │  THINKING               │
│  Full Claude Code session    │  reasoning...            │
│                              ├──────────────────────────┤
├──────────────┬───────────────┤  MCP TOOLS               │
│              │               │  ✓ Read src/index.ts     │
│  AGENT-1     │  AGENT-2      ├──────────────────────────┤
│  ✓ done     │  ⟳ working   │  FILES                   │
│              │               │  M src/index.ts          │
│              │               │  A src/utils.ts          │
└──────────────┴───────────────┴──────────────────────────┘
```

## What it does

Claude Code runs in a single terminal. When it spawns sub-agents, reasons through problems, calls tools, or edits files — all of that is interleaved in one stream. You have to scroll back and piece together what happened.

Mission Control wraps Claude Code in a pseudo-terminal and splits the output into separate panes:

- **MAIN** — The full Claude Code terminal (VT100 emulated via xterm headless)
- **AGENT-1 / AGENT-2** — Sub-agent output, appears automatically when agents spawn
- **THINKING** — Extended thinking / reasoning stream
- **MCP TOOLS** — Tool calls with status (pending / success / error)
- **FILES** — Real-time file changes detected via filesystem watcher

Panes appear and disappear automatically. No manual configuration.

## Install

```bash
git clone https://github.com/yourusername/claude-mission-control.git
cd claude-mission-control
npm install
```

### Platform-specific notes

**macOS:**
```bash
xcode-select --install   # if node-pty build fails
npm rebuild node-pty
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install build-essential python3
npm rebuild node-pty
```

**Windows:**
```bash
npm install -g windows-build-tools
npm rebuild node-pty
```

Requires Windows 10 v1809+ with Windows Terminal recommended.

## Usage

```bash
# From any project directory
cd ~/projects/my-project
npx claude-mission-control

# Or with npm start from the repo
cd claude-mission-control
npm start

# After npm link
cd ~/projects/my-project
cmc
```

Claude Code launches inside Mission Control. Type normally — your input goes to Claude Code.

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Tab | Cycle focus between panes |
| Enter | Send input to Claude Code |
| Up/Down | Scroll focused pane |
| Escape | Return focus to main / toggle input mode |
| q | Quit (when not typing) |
| Ctrl+C | Force quit |

## How it works

```
User's terminal
│
├── node-pty spawns `claude` in a pseudo-terminal
│
├── Raw PTY output feeds into:
│   ├── @xterm/headless Terminal (full VT100 emulation for MAIN pane)
│   └── Parser (regex classifier → routes to THINKING/AGENT/MCP/FILES panes)
│
├── chokidar watches working directory for file changes → FILES pane
│
└── Screen buffer renders all panes with diff-based updates (~30fps)
    Only changed cells are redrawn each frame.
```

The architecture is **non-invasive** — Claude Code doesn't know it's being wrapped. It sees a normal terminal.

## Layout states

The layout adapts automatically based on how many sub-agents are active:

**0 agents** — Main pane takes full left column, right column shows thinking/tools/files.

**1 agent** — Main shrinks vertically, agent pane appears below.

**2 agents** — Main shrinks further, two agent panes split the bottom horizontally.

Agents that finish stay visible (dimmed) until their slot is needed by a new agent.

## Requirements

- Node.js 22+
- Claude Code installed globally (`claude` in PATH)
- Terminal with 256-color support (most modern terminals)
- Minimum 100 columns x 25 rows (smaller terminals get compact layout)

## Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Terminal emulation | @xterm/headless | Full VT100 for main pane |
| Pseudo-terminal | node-pty | Spawn Claude Code cross-platform |
| File watching | chokidar | Detect file changes in real-time |
| Rendering | Custom screen buffer | Cell-based diff rendering to stdout |

No TUI framework — just raw ANSI escape codes and a custom compositor.

## License

MIT
