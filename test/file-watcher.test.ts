import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createFileWatcher } from '../src/watchers/file-watcher.js';
import type { FileWatcher, FileChangeEvent } from '../src/watchers/file-watcher.js';

/** Creates an isolated temporary directory for a single test run. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'file-watcher-test-'));
}

/** Waits for the given number of milliseconds using a real timer. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Collects all FileChangeEvent values emitted to a watcher's onChange handler
 * for the duration of the provided async action, then returns the list.
 */
async function collectEvents(
  watcher: FileWatcher,
  action: () => Promise<void>,
  propagationMs = 300,
): Promise<FileChangeEvent[]> {
  const events: FileChangeEvent[] = [];
  watcher.onChange((e) => { events.push(e); });
  await action();
  await wait(propagationMs);
  return events;
}

describe('createFileWatcher', { timeout: 10000 }, () => {
  let watcher: FileWatcher;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
    watcher = createFileWatcher();
  });

  afterEach(async () => {
    await watcher.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('start() begins watching without errors', async () => {
    expect(() => watcher.start(tmpDir)).not.toThrow();
    await wait(500);
  });

  it('stop() shuts down cleanly after start()', async () => {
    watcher.start(tmpDir);
    await wait(500);
    await expect(watcher.stop()).resolves.toBeUndefined();
  });

  it('creating a new file emits an A event with the relative path', async () => {
    watcher.start(tmpDir);
    await wait(500);

    const filePath = path.join(tmpDir, 'created.txt');
    const events = await collectEvents(watcher, async () => {
      fs.writeFileSync(filePath, 'hello');
    });

    const added = events.find((e) => e.changeType === 'A');
    expect(added).toBeDefined();
    expect(added!.filePath).toBe('created.txt');
  });

  it('modifying an existing file emits an M event', async () => {
    const filePath = path.join(tmpDir, 'existing.txt');
    fs.writeFileSync(filePath, 'initial');

    watcher.start(tmpDir);
    await wait(500);

    const events = await collectEvents(watcher, async () => {
      fs.writeFileSync(filePath, 'modified');
    });

    const modified = events.find((e) => e.changeType === 'M');
    expect(modified).toBeDefined();
    expect(modified!.filePath).toBe('existing.txt');
  });

  it('deleting a file emits a D event', async () => {
    const filePath = path.join(tmpDir, 'to-delete.txt');
    fs.writeFileSync(filePath, 'bye');

    watcher.start(tmpDir);
    await wait(500);

    const events = await collectEvents(watcher, async () => {
      fs.unlinkSync(filePath);
    });

    const deleted = events.find((e) => e.changeType === 'D');
    expect(deleted).toBeDefined();
    expect(deleted!.filePath).toBe('to-delete.txt');
  });

  it('events for node_modules/ files are suppressed', async () => {
    const nodeModulesDir = path.join(tmpDir, 'node_modules', 'some-pkg');
    fs.mkdirSync(nodeModulesDir, { recursive: true });

    watcher.start(tmpDir);
    await wait(500);

    const events: FileChangeEvent[] = [];
    watcher.onChange((e) => { events.push(e); });

    fs.writeFileSync(path.join(nodeModulesDir, 'index.js'), 'module.exports = {}');
    await wait(300);

    const nmEvents = events.filter((e) => e.filePath.includes('node_modules'));
    expect(nmEvents).toHaveLength(0);
  });

  it('events for .git/ files are suppressed', async () => {
    const gitDir = path.join(tmpDir, '.git', 'objects');
    fs.mkdirSync(gitDir, { recursive: true });

    watcher.start(tmpDir);
    await wait(500);

    const events: FileChangeEvent[] = [];
    watcher.onChange((e) => { events.push(e); });

    fs.writeFileSync(path.join(gitDir, 'abc123'), 'blob');
    await wait(300);

    const gitEvents = events.filter((e) => e.filePath.includes('.git'));
    expect(gitEvents).toHaveLength(0);
  });

  it('duplicate events within 500ms for the same file and operation are suppressed', async () => {
    watcher.start(tmpDir);
    await wait(500);

    const filePath = path.join(tmpDir, 'dedup.txt');
    const events: FileChangeEvent[] = [];
    watcher.onChange((e) => { events.push(e); });

    fs.writeFileSync(filePath, 'first');
    await wait(50);
    fs.writeFileSync(filePath, 'second');
    await wait(50);
    fs.writeFileSync(filePath, 'third');
    await wait(300);

    const addedEvents = events.filter((e) => e.changeType === 'A');
    expect(addedEvents).toHaveLength(1);
  });

  it('multiple callbacks all receive the same event', async () => {
    watcher.start(tmpDir);
    await wait(500);

    const received: Array<FileChangeEvent[]> = [[], [], []];
    watcher.onChange((e) => { received[0]!.push(e); });
    watcher.onChange((e) => { received[1]!.push(e); });
    watcher.onChange((e) => { received[2]!.push(e); });

    fs.writeFileSync(path.join(tmpDir, 'multi.txt'), 'data');
    await wait(300);

    expect(received[0]!.length).toBeGreaterThan(0);
    expect(received[1]!.length).toBeGreaterThan(0);
    expect(received[2]!.length).toBeGreaterThan(0);
    expect(received[0]![0]).toEqual(received[1]![0]);
    expect(received[1]![0]).toEqual(received[2]![0]);
  });

  it('file paths are relative to the watched CWD', async () => {
    const subDir = path.join(tmpDir, 'sub', 'nested');
    fs.mkdirSync(subDir, { recursive: true });

    watcher.start(tmpDir);
    await wait(500);

    const events = await collectEvents(watcher, async () => {
      fs.writeFileSync(path.join(subDir, 'deep.txt'), 'content');
    });

    const added = events.find((e) => e.changeType === 'A');
    expect(added).toBeDefined();
    expect(path.isAbsolute(added!.filePath)).toBe(false);
    expect(added!.filePath).toBe(path.join('sub', 'nested', 'deep.txt'));
  });
});
