<p align="center">
  <img src="https://img.shields.io/badge/Claude_Mission_Control-v0.1.0-blue?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjMEQxMTE3Ii8+PHBhdGggZD0iTTQgOGgxNk00IDE2aDE2TTEyIDRWMjAiIHN0cm9rZT0iIzU4QTZGRiIgc3Ryb2tlLXdpZHRoPSIyIi8+PC9zdmc+" alt="Mission Control">
</p>

<h1 align="center">Claude Mission Control</h1>

<p align="center">
  <strong>X-ray vision for Claude Code.</strong><br>
  See every agent, every tool call, every file change — in real time.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tests-276%20passing-brightgreen?style=flat-square" alt="Tests">
  <img src="https://img.shields.io/badge/idle%20CPU-~0%25-brightgreen?style=flat-square" alt="CPU">
  <img src="https://img.shields.io/badge/memory-~50MB-blue?style=flat-square" alt="Memory">
  <img src="https://img.shields.io/badge/render-dirty%20flag-blue?style=flat-square" alt="Render">
  <img src="https://img.shields.io/badge/deps-4%20runtime-lightgrey?style=flat-square" alt="Dependencies">
  <img src="https://img.shields.io/badge/framework-none-orange?style=flat-square" alt="No framework">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-Intel%20%2B%20Apple%20Silicon-000?style=flat-square&logo=apple&logoColor=white" alt="macOS">
  <img src="https://img.shields.io/badge/Linux-Debian%20%7C%20Arch%20%7C%20Fedora-FCC624?style=flat-square&logo=linux&logoColor=black" alt="Linux">
  <img src="https://img.shields.io/badge/Windows-10%2B%20(Terminal)-0078D6?style=flat-square&logo=windows&logoColor=white" alt="Windows">
</p>

---

```
 ● Mission Control  |  ● 3 agents  |  45 tools  |  hooks  |  F1=panels q=quit
┌─ Claude Code ──────────────────────────┬─ Explore: project structure ─────────┐
│                                        │  ✓ Read package.json                 │
│  Launching 3 agents to explore...      │  ✓ Glob **/*.ts (42 matches)         │
│                                        │  ✓ Found 15 modules, 3 layers        │
│  ● explorer-structure                  ├─ coder: implement helper ────────────┤
│  ● explorer-src                        │  ⟳ Edit src/index.ts                 │
│  ● explorer-docs                       │  + src/utils/helper.ts               │
│                                        │  → Writing module...                 │
│  Esperando resultados...               ├─ qa: run tests ─────────────────────┤
│                                        │  ⟳ Bash npm test                     │
├─ [1:Tools | 2:Files | 3:Orch | 4:Web] ┤  → Running 243 tests...             │
│  ✓ Read package.json       14:30:45    │                                      │
│  ✓ Glob **/*.ts            14:30:46    │                                      │
│  ⟳ Edit src/index.ts       14:30:48    │                                      │
│ ● passthrough                          │                                      │
└────────────────────────────────────────┴──────────────────────────────────────┘
```

## Why?

Claude Code runs in one terminal. Agents, thinking, tools, files — all mixed together. You scroll back trying to figure out what happened.

**Mission Control wraps Claude Code** and shows you everything in real time:

| Without MC | With MC |
|:---|:---|
| Agents invisible in output stream | Each agent gets its own live pane |
| Tool calls flash by | Tools tab with status + input/output preview |
| File changes buried in output | Files tab + filesystem watcher |
| Context lost between sessions | Persistent memory with error lessons |
| No idea what agents are doing | Agent panes show tool calls + file edits live |

## Install (any system)

```bash
git clone https://github.com/axeliparrea/claude-code-mission-control.git
cd claude-code-mission-control
bash setup.sh
```

**That's it.** The setup script detects your OS, installs build tools if needed, compiles native modules, builds, and links `cmc` globally.

<details>
<summary><strong>macOS (Intel + Apple Silicon M1/M2/M3/M4)</strong></summary>

```bash
bash scripts/setup-mac.sh
```
Auto-installs Xcode CLI Tools. Compiles `node-pty` for arm64 on Apple Silicon.
</details>

<details>
<summary><strong>Windows 10/11</strong></summary>

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
```
Requires Windows Terminal (recommended). Auto-installs Visual Studio Build Tools.
</details>

<details>
<summary><strong>Linux (Debian/Ubuntu/Arch/Fedora)</strong></summary>

```bash
bash scripts/setup-linux.sh
```
Auto-detects `apt`/`pacman`/`dnf` and installs `build-essential`/`base-devel`.
</details>

<details>
<summary><strong>Manual install</strong></summary>

```bash
npm install
npm run build
npm link
```
Requires: Node.js 22+, C++ build tools, Python 3
</details>

## Usage

```bash
# From any project — just type cmc
cd ~/my-project
cmc

# Resume a Claude Code session
cmc --resume

# Continue a specific conversation
cmc --continue abc123

# Pass any Claude Code flags
cmc --model opus
cmc --verbose
cmc --allowedTools "Bash,Read,Write"

# Point to a different project
cmc --cwd ~/another-project

# Combine flags
cmc --cwd ~/my-project --model opus --verbose
```

**Everything after `cmc` passes through to Claude Code.** MC is transparent — Claude doesn't know it's wrapped.

### Link it globally (use from anywhere)

After install, `cmc` is already linked. If you need to re-link:

```bash
cd claude-code-mission-control
npm link
```

Now `cmc` works from any directory on your system.

### Unlink

```bash
npm unlink -g claude-mission-control
```

## Keyboard

| Key | Action |
|:---|:---|
| **Everything** | Passes through to Claude Code (normal terminal) |
| `F1` | Toggle panel mode |
| `Ctrl+C` x2 | Quit Mission Control |

### Panel mode (F1)

| Key | Action |
|:---|:---|
| `1`-`4` | Switch bottom tab (Tools / Files / Orch / Web) |
| `Tab` | Cycle focus between panes |
| `↑` / `↓` | Scroll focused pane |
| `q` | Quit |
| `F1` | Back to passthrough |

## Features

### Agent Panes (right column)

When Claude spawns agents, they appear on the right — each with its own live feed:

- Tool calls the agent makes (`✓ Read`, `⟳ Edit`)
- Files it creates or modifies (`+ src/new.ts`, `M src/index.ts`)
- Output and results
- Up to 4 agents visible, stacked vertically

### Bottom Tabs

| Tab | Key | Shows |
|:---|:---|:---|
| **Tools** | `1` | Every tool call with status, server name, input/output preview |
| **Files** | `2` | File changes from parser + filesystem watcher |
| **Orch** | `3` | Agent tree, tool feed, session stats |
| **Web** | `4` | Fetch URLs as terminal text |

### MCP Server Visibility

When Claude uses MCP tools, MC shows the server name and data:

```
⟳ slack:send_message [slack-mcp] 14:30:45
  → {"channel": "#deploy", "text": "Build complete"}
✓ slack:send_message [slack-mcp] 14:30:47
  → Message sent
```

### Project Memory

MC remembers everything about each project — automatically, across sessions:

```
your-project/.mc/
├── memory/
│   ├── entries.json          # Project info, tech stack, decisions, error lessons
│   └── tracked-files.json    # Important files
├── sessions/
│   └── abc123.json           # Full session report with agent report cards
└── CONTEXT.md                # Injected into Claude on startup
```

**Auto-detects on first run:**
- Project name, description (package.json)
- Git branch, remote URL
- Tech stack (TypeScript, Python, Docker, etc.)

**Learns from every session:**
- What was discussed and decided
- Which agents succeeded/failed and why
- File change history
- Error lessons (accumulated, never duplicated)

### Session Reports

```
Duration: 3m 12s | Tools: 93 | Files: 5 | Errors: 1

Agents: 3 total (2 success, 1 failed)
  #1 Explore [OK] (12 tools)
     Task: Analyze project architecture
     Result: Found 15 modules across 3 layers
  #2 coder11111 [OK] (8 tools)
     Task: Implement helper module
     Files: A src/helper.ts, M src/index.ts
  #3 qa [FAIL] (5 tools)
     Task: Run test suite
     Errors: EACCES: permission denied /tmp/test.db

Errors to learn from (1):
- [qa] EACCES: permission denied /tmp/test.db
```

## Performance

| Metric | Value |
|:---|:---|
| Idle CPU | **~0%** (dirty-flag render — only draws when content changes) |
| Memory | **~50-70 MB** |
| Startup | **< 1 second** |
| Allocations per frame | **Zero** (cell reuse, in-place mutation) |
| Runtime deps | **4** (node-pty, @xterm/headless, chokidar, strip-ansi) |
| Build size | **~84 KB** (single JS bundle) |

## Responsive Layout

| Screen | Layout |
|:---|:---|
| **120+ cols** | Main (left 65%) + Agents (right 35%) + Tabs (bottom) |
| **60-120 cols** | Main (left 70%) + Agents (right 30%) + Tabs (bottom) |
| **< 60 cols** | Main only (compact mode) |

Agents stack vertically on the right. Layout recalculates instantly on resize.

## Architecture

```
Your terminal
│
├── node-pty spawns `claude` with your flags
│
├── Raw PTY output feeds:
│   ├── @xterm/headless (full VT100 → main pane)
│   └── Parser (classifies → agent/tool/file/error → routes to panes)
│
├── Hook system (IPC unix sockets):
│   ├── Injects hooks into Claude settings on start
│   ├── Claude runs hook-forward.mjs on each tool call
│   └── Structured data: tool name, agent type, MCP server
│
├── chokidar watches project → file changes (respects .gitignore)
│
├── Project memory (.mc/):
│   ├── Auto-detects project info + tech stack
│   ├── Saves session reports with agent report cards
│   ├── Accumulates error lessons
│   └── Writes CONTEXT.md → Claude reads on startup
│
└── Screen buffer (dirty-flag, diff-based, ~0% idle CPU)
```

## Testing

```bash
npm test              # 276 unit/integration tests
npm run test:e2e      # 16 headless PTY tests
npm run test:smoke    # 9 module verification tests
npm run test:all      # Everything

npm run sandbox       # Interactive mock Claude
```

## Tech Stack

| Component | Technology |
|:---|:---|
| Terminal emulation | @xterm/headless |
| Pseudo-terminal | node-pty |
| File watching | chokidar |
| Rendering | Custom compositor (zero-alloc, dirty-flag) |
| IPC | node:net unix sockets |
| Build | tsup (single-file ESM bundle) |
| Tests | vitest |
| Language | TypeScript strict |

**No TUI framework.** Raw ANSI + custom terminal compositor.

## Requirements

- **Node.js 22+**
- **Claude Code** in PATH (`npm i -g @anthropic-ai/claude-code`)
- Terminal with 256-color support
- 60+ columns recommended

## Contributing

```bash
npm run dev           # Dev mode with tsx
npm run typecheck     # Type check
npm test              # Run tests
npm run sandbox       # Test with mock Claude
npm run build         # Build to dist/
```

## License

MIT

---

<p align="center">
  Built for engineers who need to see what their AI is actually doing.
</p>
