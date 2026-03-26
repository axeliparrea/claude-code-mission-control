#!/usr/bin/env node
/**
 * Headless end-to-end test.
 * Spawns the full MC app with mock claude inside a PTY,
 * sends test commands, captures output, and verifies pane content.
 * @module test/e2e-headless
 */

import * as nodePty from 'node-pty';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const PROJECT_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

let passed = 0;
let failed = 0;
const output: string[] = [];

function assert(name: string, condition: boolean): void {
  if (condition) {
    passed++;
    process.stdout.write(`${GREEN}  PASS${RESET} ${name}\n`);
  } else {
    failed++;
    process.stdout.write(`${RED}  FAIL${RESET} ${name}\n`);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function allOutput(): string {
  return output.join('');
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

async function main(): Promise<void> {
  process.stdout.write('\nClaude Mission Control — E2E Headless Test\n\n');

  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-e2e-'));
  fs.mkdirSync(path.join(sandboxDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sandboxDir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(sandboxDir, '.claude', 'settings.local.json'), '{}');
  fs.writeFileSync(path.join(sandboxDir, 'src', 'index.ts'), 'export const x = 1;');

  const mockBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mock-bin-'));
  const mockClaudePath = path.join(PROJECT_DIR, 'test', 'sandbox', 'mock-claude.ts');
  const tsxPath = path.join(PROJECT_DIR, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs');

  fs.writeFileSync(path.join(mockBinDir, 'claude'), [
    '#!/usr/bin/env bash',
    `exec node --import "${tsxPath}" "${mockClaudePath}" "$@"`,
  ].join('\n'));
  fs.chmodSync(path.join(mockBinDir, 'claude'), 0o755);

  const env = {
    ...process.env as Record<string, string>,
    PATH: `${mockBinDir}:${process.env['PATH']}`,
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
  };

  process.stdout.write(`${DIM}  Launching MC in PTY (sandbox)...${RESET}\n`);

  const pty = nodePty.spawn('node', ['--import', tsxPath, path.join(PROJECT_DIR, 'src', 'index.ts')], {
    name: 'xterm-256color',
    cols: 140,
    rows: 45,
    cwd: sandboxDir,
    env,
  });

  pty.onData((data: string) => {
    output.push(data);
  });

  await wait(3000);

  const cleanBoot = stripAnsi(allOutput());

  process.stdout.write(`${DIM}  Boot output captured (${cleanBoot.length} chars)${RESET}\n`);

  assert('App boots without crash', cleanBoot.length > 100);
  assert('Header shows "Claude Mission Control"', cleanBoot.includes('Claude Mission Control'));
  assert('Header shows agent count', cleanBoot.includes('agents'));
  assert('Header shows tool count', cleanBoot.includes('tools'));
  assert('Header shows hooks status', cleanBoot.includes('hooks'));
  assert('Main pane border visible', cleanBoot.includes('Claude Code'));
  assert('Thinking pane border visible', cleanBoot.includes('Thinking'));
  assert('Tools pane border visible', cleanBoot.includes('Tools'));
  assert('Files pane border visible', cleanBoot.includes('Files'));
  assert('Mock claude banner visible', cleanBoot.includes('mock'));
  assert('Input area shows passthrough mode', cleanBoot.includes('passthrough'));

  process.stdout.write(`\n${DIM}  Sending "test tools"...${RESET}\n`);
  output.length = 0;
  pty.write('test tools\r');
  await wait(4000);

  const toolsOutput = stripAnsi(allOutput());
  assert('Tool call output appears (Read)', toolsOutput.includes('Read'));
  assert('Tool success marker appears', toolsOutput.includes('✓') || toolsOutput.includes('success'));

  process.stdout.write(`\n${DIM}  Sending "test thinking"...${RESET}\n`);
  output.length = 0;
  pty.write('test thinking\r');
  await wait(4000);

  const thinkingOutput = stripAnsi(allOutput());
  assert('Thinking output appears', thinkingOutput.includes('Thinking') || thinkingOutput.includes('analyze'));

  process.stdout.write(`\n${DIM}  Sending "test agents"...${RESET}\n`);
  output.length = 0;
  pty.write('test agents\r');
  await wait(5000);

  const agentsOutput = stripAnsi(allOutput());
  assert('Agent spawn visible', agentsOutput.includes('agent') || agentsOutput.includes('Agent'));

  process.stdout.write(`\n${DIM}  Testing file watcher...${RESET}\n`);
  output.length = 0;
  fs.writeFileSync(path.join(sandboxDir, 'src', 'new-file.ts'), 'export const y = 2;');
  await wait(2000);

  const fileOutput = stripAnsi(allOutput());
  assert('File watcher detects new file', fileOutput.includes('new-file') || fileOutput.includes('+'));

  process.stdout.write(`\n${DIM}  Sending Ctrl+C twice to quit...${RESET}\n`);
  pty.write('\x03');
  await wait(100);
  pty.write('\x03');
  await wait(2000);

  try { pty.kill(); } catch { }

  fs.rmSync(sandboxDir, { recursive: true, force: true });
  fs.rmSync(mockBinDir, { recursive: true, force: true });

  process.stdout.write(`\n  ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}\n\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`E2E test error: ${err}\n`);
  process.exit(1);
});
