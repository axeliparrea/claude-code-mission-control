/**
 * Chokidar-based file watcher for Mission Control.
 * Reports real-time file changes relative to a watched directory.
 * @module watchers/file-watcher
 */

import { watch } from 'chokidar';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { FSWatcher } from 'chokidar';

/**
 * Represents a single file system change event.
 */
export interface FileChangeEvent {
  /** Path to the changed file, relative to the watched CWD. */
  filePath: string;
  /** Type of change: M=modified, A=added, D=deleted. */
  changeType: 'M' | 'A' | 'D';
  /** Unix timestamp in milliseconds when the event was emitted. */
  timestamp: number;
}

/**
 * Callback invoked when a file change event is emitted.
 */
export type FileChangeCallback = (event: FileChangeEvent) => void;

/**
 * Lifecycle-managed file watcher with deduplication and normalization.
 */
export interface FileWatcher {
  /**
   * Starts watching the given directory for file changes.
   * @param cwd - Absolute path to the directory to watch
   */
  start(cwd: string): void;

  /**
   * Stops the watcher and releases all file system handles.
   * @returns Promise that resolves once the watcher has fully closed
   */
  stop(): Promise<void>;

  /**
   * Registers a callback to be invoked on each deduplicated file change event.
   * @param callback - Function to call with each FileChangeEvent
   */
  onChange(callback: FileChangeCallback): void;
}

/**
 * Returns true if a file path should be ignored by the watcher.
 * Uses segment-based matching since chokidar v4 does not support glob strings.
 */
/**
 * Parses a .gitignore file and returns an array of pattern strings.
 */
function loadGitignorePatterns(cwd: string): string[] {
  try {
    const gitignorePath = path.join(cwd, '.gitignore');
    const content = fs.readFileSync(gitignorePath, 'utf8');
    return content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Tests if a relative file path matches a gitignore-style pattern.
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  const cleanPattern = pattern.replace(/\/$/, '');
  const segments = filePath.split(path.sep);

  if (segments.includes(cleanPattern)) return true;

  if (cleanPattern.startsWith('*')) {
    const suffix = cleanPattern.slice(1);
    if (filePath.endsWith(suffix)) return true;
  }

  if (cleanPattern.includes('/')) {
    if (filePath.startsWith(cleanPattern)) return true;
  }

  if (filePath === cleanPattern) return true;

  return false;
}

const ALWAYS_IGNORED = ['node_modules', '.git', '.DS_Store'];

/**
 * Returns true if a file path should be ignored by the watcher.
 * Checks hardcoded ignores + .gitignore patterns.
 */
function isIgnoredPath(filePath: string, gitignorePatterns: string[]): boolean {
  const segments = filePath.split(path.sep);

  for (const dir of ALWAYS_IGNORED) {
    if (segments.includes(dir)) return true;
  }

  for (const pattern of gitignorePatterns) {
    if (matchesPattern(filePath, pattern)) return true;
  }

  return false;
}

const DEDUP_WINDOW_MS = 500;

const CHOKIDAR_EVENT_MAP: Record<string, FileChangeEvent['changeType']> = {
  add: 'A',
  change: 'M',
  unlink: 'D',
};

/**
 * Creates a new FileWatcher instance using chokidar as the underlying
 * file system monitor. Events within the same 500ms window for the same
 * file and operation are suppressed to avoid flooding consumers.
 * @returns A fresh, unstarted FileWatcher
 */
export function createFileWatcher(): FileWatcher {
  let watcher: FSWatcher | null = null;
  let watchedCwd = '';
  const callbacks: FileChangeCallback[] = [];
  const dedupMap = new Map<string, number>();

  function buildDedupKey(filePath: string, changeType: FileChangeEvent['changeType']): string {
    return `${changeType}:${filePath}`;
  }

  function isDuplicate(dedupKey: string, now: number): boolean {
    const last = dedupMap.get(dedupKey);
    if (dedupMap.size > 500) {
      for (const [k, t] of dedupMap) {
        if (now - t > DEDUP_WINDOW_MS * 2) dedupMap.delete(k);
      }
    }
    return last !== undefined && now - last < DEDUP_WINDOW_MS;
  }

  function handleChokidarEvent(eventName: string, absolutePath: string): void {
    const changeType = CHOKIDAR_EVENT_MAP[eventName];
    if (changeType === undefined) {
      return;
    }

    const filePath = path.relative(watchedCwd, absolutePath);
    const now = Date.now();
    const dedupKey = buildDedupKey(filePath, changeType);

    if (isDuplicate(dedupKey, now)) {
      return;
    }

    dedupMap.set(dedupKey, now);

    const event: FileChangeEvent = { filePath, changeType, timestamp: now };
    for (const cb of callbacks) {
      cb(event);
    }
  }

  return {
    start(cwd: string): void {
      watchedCwd = cwd;
      const gitignorePatterns = loadGitignorePatterns(cwd);
      watcher = watch(cwd, {
        ignored: (p: string) => isIgnoredPath(path.relative(cwd, p), gitignorePatterns),
        ignoreInitial: true,
        persistent: true,
        depth: 5,
      });

      watcher.on('add', (p: string) => { handleChokidarEvent('add', p); });
      watcher.on('change', (p: string) => { handleChokidarEvent('change', p); });
      watcher.on('unlink', (p: string) => { handleChokidarEvent('unlink', p); });
      watcher.on('error', () => {});
    },

    async stop(): Promise<void> {
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
      dedupMap.clear();
    },

    onChange(callback: FileChangeCallback): void {
      callbacks.push(callback);
    },
  };
}
