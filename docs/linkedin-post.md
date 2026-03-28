# LinkedIn Post

---

I built an open-source terminal multiplexer for Claude Code.

It's called **Mission Control** — and it lets you see everything your AI coding assistant is doing in real time.

When Claude Code spawns 5 agents to analyze your codebase, you don't have to scroll through a single terminal trying to figure out what happened. Each agent gets its own live pane. Every tool call, every file edit, every decision — visible as it happens.

**What it does:**

→ Real-time agent panes — see what each sub-agent is reading, editing, and creating
→ Orchestrator dashboard — agent tree with success/fail status, tool counts, session stats
→ Tool visibility — every Read, Edit, Bash, Grep call tracked with MCP server names
→ Persistent project memory — remembers tech stack, error lessons, and session history per repo
→ Session reports — agent report cards showing which agents succeeded and which failed, and why

**How it works:**

Mission Control wraps Claude Code in a pseudo-terminal. Raw PTY output feeds into a VT100 emulator (@xterm/headless) for the main pane and a parser pipeline that classifies every line into agents, tools, files, or errors — routing each to the correct pane.

A hook system injects into Claude Code's settings on startup. Every tool call triggers a forwarding script that sends structured JSON over a Unix socket to MC. This gives us reliable, structured data about tool names, agent types, MCP servers, and success/failure status — no regex guessing.

File changes are detected in real time via chokidar (respects .gitignore). Everything renders through a custom terminal compositor with dirty-flag rendering — zero CPU when idle, zero allocations per frame.

**The orchestrator:**

MC tracks every agent Claude spawns — its type, model, prompt, tools used, files edited, and result. The orchestrator builds a live agent tree:

```
Agent Tree
  ├─ ✓ Explore (sonnet) 1m25s 92%
  │   → Analyze project architecture
  │   12 tools
  │   Found 15 modules across 3 layers
  ├─ ✗ coder11111 (sonnet) 48s
  │   → Fix authentication bug
  │   Errors: EACCES permission denied
  └─ ⟳ qa (haiku) 32s
      → Run test suite
      8 tools
```

**Per-project memory:**

Every project gets a `.mc/` directory with persistent memory across sessions. MC auto-detects the project name, git remote, branch, and tech stack on first run. Every session saves a detailed report — what was discussed, which agents ran, what files changed, and what errors occurred.

Errors accumulate as "lessons learned" and are injected as context in future sessions, so Claude doesn't repeat the same mistakes.

**Performance:**

- ~0% idle CPU (dirty-flag render — only draws when content changes)
- ~50MB memory footprint
- Zero object allocations per frame (in-place cell mutation)
- 4 runtime dependencies
- No TUI framework — raw ANSI escape codes + custom compositor

**The stack:**

TypeScript strict, Node.js 22+, @xterm/headless for VT100 emulation, node-pty for cross-platform pseudo-terminals, chokidar for file watching, Unix sockets for hook IPC. Single-file ESM bundle via tsup. 276 tests.

Works on macOS (Intel + Apple Silicon), Linux, and Windows.

**Try it:**

```
git clone https://github.com/axeliparrea/claude-code-mission-control
cd claude-code-mission-control
bash setup.sh
cmc
```

Open source. MIT license. Contributions welcome.

If you're building with Claude Code and want to actually see what your agents are doing — give it a try. PRs, issues, and ideas are welcome.

GitHub: https://github.com/axeliparrea/claude-code-mission-control

#ClaudeCode #AI #OpenSource #DeveloperTools #AIEngineering #Terminal #Anthropic #AgentOrchestration #BuildInPublic

---

## Suggested images for LinkedIn

1. `docs/images/mc-agents-orch.png` — Main hero image (agents + orchestrator)
2. `docs/images/mc-main.png` — Agent panes with code review
3. `docs/images/mc-tools.png` — Deep tool call visibility
