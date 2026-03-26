/**
 * Chokidar-based file watcher for Mission Control.
 * Reports real-time file changes relative to a watched directory.
 * @module watchers/file-watcher
 */

import { watch } from 'chokidar';
import * as path from 'node:path';
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
function isIgnoredPath(filePath: string): boolean {
  const segments = filePath.split(path.sep);
  if (segments.includes('node_modules')) return true;
  if (segments.includes('.git')) return true;
  if (segments.includes('dist')) return true;
  if (filePath.endsWith('.lock')) return true;
  if (segments.includes('.DS_Store')) return true;
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
      watcher = watch(cwd, {
        ignored: (p: string) => isIgnoredPath(path.relative(cwd, p)),
        ignoreInitial: true,
        persistent: true,
      });

      watcher.on('add', (p: string) => { handleChokidarEvent('add', p); });
      watcher.on('change', (p: string) => { handleChokidarEvent('change', p); });
      watcher.on('unlink', (p: string) => { handleChokidarEvent('unlink', p); });
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
