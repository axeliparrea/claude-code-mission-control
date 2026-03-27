#!/usr/bin/env bash
# Universal setup — detects platform and runs the right script
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$(uname -s)" in
  Darwin)  bash "$SCRIPT_DIR/scripts/setup-mac.sh" ;;
  Linux)   bash "$SCRIPT_DIR/scripts/setup-linux.sh" ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "On Windows, run: powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1"
    ;;
  *)
    echo "Unknown platform: $(uname -s)"
    echo "Try: npm install && npm run build && npm link"
    ;;
esac
