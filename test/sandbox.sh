#!/usr/bin/env bash
# Sandbox runner for Claude Mission Control testing.
# Creates a temporary bin directory containing a mock `claude` shim that
# executes mock-claude.ts instead of the real binary, then launches the TUI.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

MOCK_BIN=$(mktemp -d)
trap "rm -rf $MOCK_BIN" EXIT

cat > "$MOCK_BIN/claude" << EOF
#!/usr/bin/env bash
exec node --import tsx "$SCRIPT_DIR/mock-claude.ts" "\$@"
EOF
chmod +x "$MOCK_BIN/claude"

export PATH="$MOCK_BIN:$PATH"

printf "Starting Claude Mission Control in sandbox mode...\n"
printf "   Mock claude: %s/claude\n" "$MOCK_BIN"
printf "   Commands: test thinking | test tools | test agents | test files | test all | test stress\n\n"

exec node --import tsx "$PROJECT_DIR/src/index.ts" "$@"
