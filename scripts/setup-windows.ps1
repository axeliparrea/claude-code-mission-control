# Setup script for Windows (PowerShell)
# Requires: Node.js 22+, Windows 10 v1809+, Windows Terminal recommended

$ErrorActionPreference = "Stop"

Write-Host "=== Claude Mission Control - Windows Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
try {
    $nodeVersion = (node -v) -replace 'v', ''
    $major = [int]($nodeVersion.Split('.')[0])
    if ($major -lt 22) {
        Write-Host "ERROR: Node.js 22+ required (found v$nodeVersion)" -ForegroundColor Red
        Write-Host "  Download from https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Node.js v$nodeVersion OK" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Node.js not found." -ForegroundColor Red
    Write-Host "  Download from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

# Check for build tools (required for node-pty on Windows)
Write-Host ""
Write-Host "Checking build tools..."

try {
    $vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vsWhere) {
        Write-Host "Visual Studio Build Tools found" -ForegroundColor Green
    } else {
        throw "Not found"
    }
} catch {
    Write-Host "Visual Studio Build Tools not found. Installing..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Option 1 (recommended):" -ForegroundColor Cyan
    Write-Host "  npm install -g windows-build-tools"
    Write-Host ""
    Write-Host "Option 2 (manual):" -ForegroundColor Cyan
    Write-Host "  Download Visual Studio Build Tools from:"
    Write-Host "  https://visualstudio.microsoft.com/visual-cpp-build-tools/"
    Write-Host "  Select 'Desktop development with C++' workload"
    Write-Host ""

    $response = Read-Host "Try installing via npm? (y/n)"
    if ($response -eq 'y') {
        npm install -g windows-build-tools
    } else {
        Write-Host "Install build tools manually, then run this script again." -ForegroundColor Yellow
        exit 0
    }
}

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..."
npm install

# Rebuild native modules
Write-Host ""
Write-Host "Building native modules..."
npm rebuild node-pty

# Build
Write-Host ""
Write-Host "Building Mission Control..."
npm run build

# Link globally
Write-Host ""
Write-Host "Linking 'cmc' command globally..."
npm link

Write-Host ""
Write-Host "=== Setup complete! ===" -ForegroundColor Green
Write-Host ""
Write-Host "Usage:" -ForegroundColor Cyan
Write-Host "  cd C:\your\project"
Write-Host "  cmc"
Write-Host ""
Write-Host "IMPORTANT: Use Windows Terminal for best experience." -ForegroundColor Yellow
Write-Host "  CMD.exe has limited ANSI support." -ForegroundColor Yellow
