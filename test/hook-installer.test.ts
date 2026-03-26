import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHookInstaller } from '../src/hooks/hook-installer.js';
import type { HookInstaller } from '../src/hooks/hook-installer.js';

const IPC_PATH = '/tmp/mc-test.sock';
const HOOK_SCRIPT = '/usr/local/lib/hook-forward.js';
const MC_HOOK_MARKER = 'mission-control-hook';

/**
 * Creates a temporary directory and returns its path.
 */
function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-installer-test-'));
}

/**
 * Removes a directory tree recursively, ignoring errors.
 */
function removeTmpDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
  }
}

/**
 * Reads and parses the settings.local.json in the given cwd.
 */
function readSettings(cwd: string): Record<string, unknown> {
  const filePath = path.join(cwd, '.claude', 'settings.local.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Writes a settings object as formatted JSON into .claude/settings.local.json.
 */
function writeSettings(cwd: string, settings: Record<string, unknown>): void {
  const dir = path.join(cwd, '.claude');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, 'settings.local.json'),
    JSON.stringify(settings, null, 2) + '\n',
    'utf8',
  );
}

describe('createHookInstaller', () => {
  let tmpDir: string;
  let installer: HookInstaller;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    installer = createHookInstaller(tmpDir);
  });

  afterEach(() => {
    removeTmpDir(tmpDir);
  });

  it('install() creates .claude/settings.local.json with hook entries', () => {
    installer.install(IPC_PATH, HOOK_SCRIPT);

    const settings = readSettings(tmpDir);
    const hooks = settings['hooks'] as Record<string, unknown[]>;

    expect(Array.isArray(hooks['PreToolUse'])).toBe(true);
    expect(Array.isArray(hooks['PostToolUse'])).toBe(true);
    expect(Array.isArray(hooks['Stop'])).toBe(true);

    const preEntry = hooks['PreToolUse']![0] as Record<string, unknown>;
    expect(preEntry['matcher']).toBe('');
    const innerHooks = preEntry['hooks'] as Array<Record<string, string>>;
    expect(innerHooks).toHaveLength(1);
    expect(innerHooks[0]!['type']).toBe('command');
    expect(innerHooks[0]!['command']).toContain(HOOK_SCRIPT);
    expect(innerHooks[0]!['command']).toContain(IPC_PATH);
    expect(innerHooks[0]!['command']).toContain(MC_HOOK_MARKER);
  });

  it('install() creates a backup of existing settings', () => {
    writeSettings(tmpDir, { theme: 'dark' });

    installer.install(IPC_PATH, HOOK_SCRIPT);

    const backupPath = path.join(tmpDir, '.claude', 'settings.local.json.mc-backup');
    expect(fs.existsSync(backupPath)).toBe(true);

    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8')) as Record<string, unknown>;
    expect(backup['theme']).toBe('dark');
  });

  it('install() preserves existing hook entries that are not MC-owned', () => {
    const existingEntry = { type: 'command', command: 'echo hello' };
    writeSettings(tmpDir, {
      hooks: { PreToolUse: [existingEntry] },
    });

    installer.install(IPC_PATH, HOOK_SCRIPT);

    const settings = readSettings(tmpDir);
    const hooks = settings['hooks'] as Record<string, unknown[]>;
    const preHooks = hooks['PreToolUse']!;

    const hasExisting = preHooks.some(
      (e) => (e as Record<string, unknown>)['command'] === 'echo hello',
    );
    expect(hasExisting).toBe(true);
  });

  it('uninstall() restores settings from backup', () => {
    writeSettings(tmpDir, { model: 'opus' });

    installer.install(IPC_PATH, HOOK_SCRIPT);
    installer.uninstall();

    const settings = readSettings(tmpDir);
    expect(settings['model']).toBe('opus');
    expect(settings['hooks']).toBeUndefined();
  });

  it('uninstall() removes the backup file', () => {
    writeSettings(tmpDir, { model: 'sonnet' });

    installer.install(IPC_PATH, HOOK_SCRIPT);
    installer.uninstall();

    const backupPath = path.join(tmpDir, '.claude', 'settings.local.json.mc-backup');
    expect(fs.existsSync(backupPath)).toBe(false);
  });

  it('uninstall() removes the lock file', () => {
    installer.install(IPC_PATH, HOOK_SCRIPT);

    const lockPath = path.join(os.tmpdir(), `mission-control-${process.pid}.lock`);
    expect(fs.existsSync(lockPath)).toBe(true);

    installer.uninstall();

    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('install() then uninstall() round-trips cleanly', () => {
    const original = { version: '1.0', theme: 'light' };
    writeSettings(tmpDir, original);

    installer.install(IPC_PATH, HOOK_SCRIPT);
    installer.uninstall();

    const restored = readSettings(tmpDir);
    expect(restored['version']).toBe('1.0');
    expect(restored['theme']).toBe('light');
    expect(restored['hooks']).toBeUndefined();
  });

  it('install() on empty directory creates .claude/ and the settings file', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    expect(fs.existsSync(claudeDir)).toBe(false);

    installer.install(IPC_PATH, HOOK_SCRIPT);

    expect(fs.existsSync(claudeDir)).toBe(true);
    expect(fs.existsSync(path.join(claudeDir, 'settings.local.json'))).toBe(true);
  });

  it('multiple installs do not duplicate MC entries (idempotent)', () => {
    installer.install(IPC_PATH, HOOK_SCRIPT);
    installer.install(IPC_PATH, HOOK_SCRIPT);
    installer.install(IPC_PATH, HOOK_SCRIPT);

    const settings = readSettings(tmpDir);
    const hooks = settings['hooks'] as Record<string, unknown[]>;

    function countMcEntries(entries: unknown[]): number {
      return entries.filter((e) => {
        const obj = e as Record<string, unknown>;
        const innerHooks = obj['hooks'] as Array<Record<string, string>> | undefined;
        if (!Array.isArray(innerHooks)) return false;
        return innerHooks.some((h) => h['command']?.includes(MC_HOOK_MARKER));
      }).length;
    }

    expect(countMcEntries(hooks['PreToolUse']!)).toBe(1);
    expect(countMcEntries(hooks['PostToolUse']!)).toBe(1);
    expect(countMcEntries(hooks['Stop']!)).toBe(1);
  });
});
