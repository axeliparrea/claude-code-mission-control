#!/usr/bin/env bash
# Sandbox runner for Claude Mission Control.
# Creates a temporary workspace with a mock `claude` shim,
# then launches the TUI so you can interact with it.
#
# Usage:
#   ./test/sandbox/run.sh              # interactive mock
#   ./test/sandbox/run.sh --scenario   # run all test scenarios automatically

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
SANDBOX_DIR=$(mktemp -d)

trap 'rm -rf "$SANDBOX_DIR"' EXIT

# Create a fake project structure in the sandbox
mkdir -p "$SANDBOX_DIR/src"
mkdir -p "$SANDBOX_DIR/.claude"
echo '{}' > "$SANDBOX_DIR/.claude/settings.local.json"
echo 'export function hello() { return "world"; }' > "$SANDBOX_DIR/src/index.ts"
echo '{ "name": "sandbox-project" }' > "$SANDBOX_DIR/package.json"

# Create mock claude binary
MOCK_BIN=$(mktemp -d)
trap 'rm -rf "$SANDBOX_DIR" "$MOCK_BIN"' EXIT

cat > "$MOCK_BIN/claude" << 'SHIM'
#!/usr/bin/env bash
SCRIPT_DIR_INNER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node --import tsx "$MC_MOCK_CLAUDE_PATH" "$@"
SHIM
chmod +x "$MOCK_BIN/claude"

export PATH="$MOCK_BIN:$PATH"
export MC_MOCK_CLAUDE_PATH="$SCRIPT_DIR/mock-claude.ts"

cd "$SANDBOX_DIR" || exit 1

printf "╔═══════════════════════════════════════════════╗\n"
printf "║  Claude Mission Control — Sandbox Mode        ║\n"
printf "╠═══════════════════════════════════════════════╣\n"
printf "║  Workspace: %s\n" "$SANDBOX_DIR"
printf "║  Mock claude: %s/claude\n" "$MOCK_BIN"
printf "║                                               ║\n"
printf "║  Commands inside MC:                          ║\n"
printf "║    test thinking  — thinking block demo       ║\n"
printf "║    test tools     — tool calls demo           ║\n"
printf "║    test agents    — agent lifecycle demo      ║\n"
printf "║    test files     — file changes demo         ║\n"
printf "║    test all       — run everything            ║\n"
printf "║    test stress    — 200 lines rapid fire      ║\n"
printf "║                                               ║\n"
printf "║  Controls:                                    ║\n"
printf "║    Esc        — toggle panel mode             ║\n"
printf "║    Tab        — cycle panels (in panel mode)  ║\n"
printf "║    ↑/↓        — scroll (in panel mode)        ║\n"
printf "║    q          — quit (in panel mode)          ║\n"
printf "║    Ctrl+C x2  — force quit                    ║\n"
printf "╚═══════════════════════════════════════════════╝\n\n"

exec node --import tsx "$PROJECT_DIR/src/index.ts" "$@"
