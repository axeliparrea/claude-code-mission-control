/**
 * Installs and uninstalls Mission Control hooks into Claude Code settings.
 * Manages backup/restore of original settings and crash recovery via lock files.
 * @module hooks/hook-installer
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Manages the lifecycle of Mission Control hook entries in Claude Code settings files.
 */
export interface HookInstaller {
  /**
   * Injects MC hook entries into the Claude Code settings file.
   * Creates a backup of the original settings before modification.
   * @param ipcPath - The IPC socket path to pass as MC_IPC_PATH to hook scripts
   * @param hookScriptPath - Absolute path to the hook-forward.js script
   * @returns The settings file path that was modified
   */
  install(ipcPath: string, hookScriptPath: string): string;

  /**
   * Restores the original settings from backup and cleans up lock/backup files.
   */
  uninstall(): void;

  /**
   * Checks for orphaned lock files from a previous crash and cleans up if needed.
   */
  recoverFromCrash(): void;
}

/**
 * Sentinel string embedded in hook commands to identify MC-owned entries.
 */
const MC_HOOK_MARKER = 'mission-control-hook';

/**
 * Resolves the Claude Code settings file path for the current project.
 * Uses the project-local `.claude/settings.local.json`.
 * @param cwd - Working directory of the project
 */
function settingsPath(cwd: string): string {
  return path.join(cwd, '.claude', 'settings.local.json');
}

/**
 * Returns the backup file path for a given settings file.
 */
function backupPath(settingsFile: string): string {
  return settingsFile + '.mc-backup';
}

/**
 * Returns the lock file path for the current process.
 */
function lockFilePath(): string {
  return path.join(os.tmpdir(), `mission-control-${process.pid}.lock`);
}

/**
 * Reads and parses a JSON settings file, returning an empty object if it doesn't exist.
 */
function readSettings(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes a settings object as formatted JSON.
 */
function writeSettings(filePath: string, settings: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

/**
 * Builds the hook command string for a given hook type.
 */
function buildHookCommand(hookScriptPath: string, hookType: string): string {
  return `node ${hookScriptPath} ${hookType}`;
}

/**
 * Builds a single hook entry object for Claude Code settings.
 */
function buildHookEntry(hookScriptPath: string, hookType: string, ipcPath: string): Record<string, unknown> {
  return {
    type: 'command',
    command: buildHookCommand(hookScriptPath, hookType),
    env: { MC_IPC_PATH: ipcPath, MC_HOOK_ID: MC_HOOK_MARKER },
  };
}

/**
 * Returns true if a hook entry was installed by Mission Control.
 */
function isMcHookEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false;
  const obj = entry as Record<string, unknown>;
  if (typeof obj['env'] !== 'object' || obj['env'] === null) return false;
  const env = obj['env'] as Record<string, unknown>;
  return env['MC_HOOK_ID'] === MC_HOOK_MARKER;
}

/**
 * Removes all MC hook entries from a hooks array.
 */
function stripMcEntries(hooks: unknown[]): unknown[] {
  return hooks.filter((entry) => !isMcHookEntry(entry));
}

/**
 * Ensures the hooks property for a given hook type is an array and appends the MC entry.
 */
function injectHookEntry(
  hooks: Record<string, unknown>,
  hookType: string,
  entry: Record<string, unknown>,
): void {
  const existing = Array.isArray(hooks[hookType]) ? hooks[hookType] as unknown[] : [];
  const cleaned = stripMcEntries(existing);
  hooks[hookType] = [...cleaned, entry];
}

/**
 * Creates a new {@link HookInstaller} bound to the given working directory.
 * @param cwd - The project working directory where `.claude/settings.local.json` lives
 * @returns A ready-to-use HookInstaller
 */
export function createHookInstaller(cwd: string): HookInstaller {
  const sPath = settingsPath(cwd);
  const bPath = backupPath(sPath);
  const lPath = lockFilePath();

  return {
    install(ipcPath: string, hookScriptPath: string): string {
      const settings = readSettings(sPath);

      if (!fs.existsSync(bPath)) {
        writeSettings(bPath, settings);
      }

      const hooks = (typeof settings['hooks'] === 'object' && settings['hooks'] !== null)
        ? settings['hooks'] as Record<string, unknown>
        : {};

      injectHookEntry(hooks, 'PreToolUse', buildHookEntry(hookScriptPath, 'PreToolUse', ipcPath));
      injectHookEntry(hooks, 'PostToolUse', buildHookEntry(hookScriptPath, 'PostToolUse', ipcPath));
      injectHookEntry(hooks, 'Stop', buildHookEntry(hookScriptPath, 'Stop', ipcPath));

      settings['hooks'] = hooks;
      writeSettings(sPath, settings);

      fs.writeFileSync(lPath, String(process.pid), 'utf8');

      return sPath;
    },

    uninstall(): void {
      try {
        if (fs.existsSync(bPath)) {
          fs.copyFileSync(bPath, sPath);
          fs.unlinkSync(bPath);
        } else {
          const settings = readSettings(sPath);
          const hooks = (typeof settings['hooks'] === 'object' && settings['hooks'] !== null)
            ? settings['hooks'] as Record<string, unknown>
            : {};

          for (const hookType of ['PreToolUse', 'PostToolUse', 'Stop']) {
            if (Array.isArray(hooks[hookType])) {
              hooks[hookType] = stripMcEntries(hooks[hookType] as unknown[]);
            }
          }

          settings['hooks'] = hooks;
          writeSettings(sPath, settings);
        }
      } catch {
      }

      try { fs.unlinkSync(lPath); } catch { }
    },

    recoverFromCrash(): void {
      const tmpDir = os.tmpdir();
      let entries: string[];
      try {
        entries = fs.readdirSync(tmpDir);
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.startsWith('mission-control-') || !entry.endsWith('.lock')) continue;

        const fullPath = path.join(tmpDir, entry);
        let pid: number;
        try {
          pid = parseInt(fs.readFileSync(fullPath, 'utf8').trim(), 10);
        } catch {
          continue;
        }

        let alive = false;
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }

        if (!alive) {
          if (fs.existsSync(bPath)) {
            try {
              fs.copyFileSync(bPath, sPath);
              fs.unlinkSync(bPath);
            } catch { }
          }
          try { fs.unlinkSync(fullPath); } catch { }
        }
      }
    },
  };
}
