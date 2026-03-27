#!/usr/bin/env bash
# Setup script for Linux (Debian/Ubuntu, Arch, Fedora)
set -e

echo "=== Claude Mission Control — Linux Setup ==="
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found."
  echo "  Install via nvm: https://github.com/nvm-sh/nvm"
  echo "  Or your package manager"
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo "ERROR: Node.js 22+ required (found v$NODE_VERSION)"
  exit 1
fi

echo "Node.js $(node -v) OK"

# Check build tools for node-pty
if ! command -v gcc &> /dev/null || ! command -v make &> /dev/null; then
  echo ""
  echo "Build tools missing. Installing..."

  if command -v apt-get &> /dev/null; then
    echo "  sudo apt-get install -y build-essential python3"
    sudo apt-get install -y build-essential python3
  elif command -v pacman &> /dev/null; then
    echo "  sudo pacman -S --needed base-devel python"
    sudo pacman -S --needed base-devel python
  elif command -v dnf &> /dev/null; then
    echo "  sudo dnf groupinstall 'Development Tools'"
    sudo dnf groupinstall "Development Tools"
    sudo dnf install python3
  else
    echo "  Install gcc, make, and python3 manually"
    exit 1
  fi
fi

echo "Build tools OK"

# Install
echo ""
echo "Installing dependencies..."
npm install

# Rebuild native modules
echo ""
echo "Building native modules..."
npm rebuild node-pty

# Build
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
