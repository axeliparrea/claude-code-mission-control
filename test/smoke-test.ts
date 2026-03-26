#!/usr/bin/env node
/**
 * Smoke test — verifies all modules can be imported and instantiated
 * without launching the full TUI. Tests the wiring at module level.
 * @module test/smoke-test
 */

import { createScreenBuffer } from '../src/screen.js';
import { createTerminalPane } from '../src/terminal-pane.js';
import { createTextPane } from '../src/text-pane.js';
import { createParser } from '../src/parser.js';
import { calculateLayout } from '../src/layout.js';
import { createHookServer } from '../src/hooks/hook-server.js';
import { createHookInstaller } from '../src/hooks/hook-installer.js';
import { createFileWatcher } from '../src/watchers/file-watcher.js';
import { fg, icons } from '../src/theme.js';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => boolean | Promise<boolean>): Promise<void> {
  return Promise.resolve(fn()).then((ok) => {
    if (ok) {
      passed++;
      process.stdout.write(`${GREEN}  PASS${RESET} ${name}\n`);
    } else {
      failed++;
      process.stdout.write(`${RED}  FAIL${RESET} ${name}\n`);
    }
  }).catch((err) => {
    failed++;
    process.stdout.write(`${RED}  FAIL${RESET} ${name}: ${err}\n`);
  });
}

async function main(): Promise<void> {
  process.stdout.write('\nClaude Mission Control — Smoke Test\n\n');

  await check('Screen buffer creates and resizes', () => {
    const screen = createScreenBuffer(80, 24);
    screen.clear();
    screen.resize(120, 40);
    return screen.cols === 120 && screen.rows === 40;
  });

  await check('Terminal pane creates and writes data', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    const pane = createTerminalPane('test', 'Test', layout.main, fg.main);
    pane.write('Hello world\r\n');
    return true;
  });

  await check('Text pane creates, appends, scrolls', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    const pane = createTextPane('think', 'Thinking', layout.thinking, fg.thinking);
    pane.appendLine('Line 1');
    pane.appendLine('Line 2');
    pane.scrollUp();
    pane.scrollDown();
    return pane.lines.length === 2;
  });

  await check('Layout calculates all states', () => {
    const solo = calculateLayout(120, 40, 'solo', 0);
    const single = calculateLayout(120, 40, 'single', 1);
    const dual = calculateLayout(120, 40, 'dual', 2);
    const compact = calculateLayout(80, 20, 'compact', 0);
    return solo.agents.length === 0
      && single.agents.length === 1
      && dual.agents.length === 2
      && compact.thinking.width === 0;
  });

  await check('Parser classifies thinking, tools, files, errors', () => {
    const parser = createParser();
    const chunks = parser.feed(
      '⚡ Thinking...\nTool: Read\nCreated: src/new.ts\nError: something failed\n'
    );
    return chunks.length === 4
      && chunks[0]!.type === 'thinking'
      && chunks[1]!.type === 'mcp'
      && chunks[2]!.type === 'file'
      && chunks[3]!.type === 'error';
  });

  await check('Hook server starts and stops', async () => {
    const server = createHookServer();
    const sid = crypto.randomBytes(4).toString('hex');
    await server.start(sid);
    const hasPath = server.ipcPath.length > 0;
    await server.stop();
    return hasPath;
  });

  await check('Hook installer installs and uninstalls', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-smoke-'));
    const installer = createHookInstaller(tmpDir);
    installer.install('/tmp/test.sock', '/usr/bin/hook-forward.js');
    const settingsFile = path.join(tmpDir, '.claude', 'settings.local.json');
    const exists = fs.existsSync(settingsFile);
    installer.uninstall();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return exists;
  });

  await check('File watcher creates without errors', () => {
    const watcher = createFileWatcher();
    return watcher !== null;
  });

  await check('Theme has all expected colors', () => {
    return fg.main.length > 0 && fg.thinking.length > 0 && fg.mcp.length > 0
      && icons.success === '✓' && icons.error === '✗';
  });

  process.stdout.write(`\n  ${passed} passed, ${failed} failed\n\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
