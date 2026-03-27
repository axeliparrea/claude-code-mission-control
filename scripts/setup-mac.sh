#!/usr/bin/env bash
# Setup script for macOS (Intel + Apple Silicon)
set -e

echo "=== Claude Mission Control — macOS Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install via:"
  echo "  brew install node"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required (found v$NODE_VERSION)"
  echo "  brew upgrade node"
  exit 1
fi

echo "Node.js $(node -v) OK"

# Check Xcode Command Line Tools (required for node-pty)
if ! xcode-select -p &> /dev/null; then
  echo ""
  echo "Installing Xcode Command Line Tools (required for native modules)..."
  xcode-select --install
  echo ""
  echo "After installation completes, run this script again."
  exit 0
fi

echo "Xcode CLI Tools OK"

# Detect architecture
ARCH=$(uname -m)
echo "Architecture: $ARCH"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Rebuild native modules for current architecture
echo ""
echo "Building native modules for $ARCH..."
npm rebuild node-pty

# Build Mission Control
echo ""
echo "Building Mission Control..."
npm run build

# Link globally
echo ""
echo "Linking 'cmc' command globally..."
npm link

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Usage:"
echo "  cd ~/your-project"
echo "  cmc"
echo ""
echo "Or specify a directory:"
echo "  cmc --cwd ~/your-project"
