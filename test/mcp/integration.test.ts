/**
 * Integration tests for the full Mission Control pipeline.
 * Tests hook server + hook installer + file watcher + parser working together
 * without launching the TUI — verifies the data flow end-to-end.
 * @module test/mcp/integration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { createHookServer } from '../../src/hooks/hook-server.js';
import { createHookInstaller } from '../../src/hooks/hook-installer.js';
import { createFileWatcher } from '../../src/watchers/file-watcher.js';
import { createParser } from '../../src/parser.js';
import type { HookEvent } from '../../src/hooks/hook-server.js';
import type { FileChangeEvent } from '../../src/watchers/file-watcher.js';
import type { ParsedChunk } from '../../src/types.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueSessionId(): string {
  return crypto.randomBytes(6).toString('hex');
}

function sendToSocket(socketPath: string, data: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(data) + '\n');
      client.end();
    });
    client.on('close', () => resolve());
    client.on('error', reject);
  });
}

describe('Full pipeline integration', { timeout: 15000 }, () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-integration-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('hook server receives PreToolUse and converts to tool_start event', async () => {
    const server = createHookServer();
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    await sendToSocket(server.ipcPath, {
      hookType: 'PreToolUse',
      timestamp: Date.now(),
      payload: { tool_name: 'Read', tool_input: { file_path: 'src/index.ts' } },
    });

    await wait(100);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('tool_start');
    expect(events[0]!.toolName).toBe('Read');

    await server.stop();
  });

  it('hook server converts Agent PreToolUse to agent_spawn', async () => {
    const server = createHookServer();
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    await sendToSocket(server.ipcPath, {
      hookType: 'PreToolUse',
      timestamp: Date.now(),
      payload: {
        tool_name: 'Agent',
        tool_input: { agentType: 'Explore', agentPrompt: 'Search codebase', agentModel: 'sonnet' },
      },
    });

    await wait(100);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('agent_spawn');
    expect(events[0]!.agentType).toBe('Explore');
    expect(events[0]!.agentPrompt).toBe('Search codebase');

    await server.stop();
  });

  it('hook installer round-trips settings cleanly', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    const settingsFile = path.join(tmpDir, '.claude', 'settings.local.json');
    fs.writeFileSync(settingsFile, JSON.stringify({ env: { FOO: 'bar' } }, null, 2));

    const installer = createHookInstaller(tmpDir);
    installer.install('/tmp/test.sock', '/usr/local/bin/hook-forward.js');

    const afterInstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(afterInstall.hooks).toBeDefined();
    expect(afterInstall.hooks.PreToolUse).toHaveLength(1);
    expect(afterInstall.hooks.PostToolUse).toHaveLength(1);
    expect(afterInstall.hooks.Stop).toHaveLength(1);
    expect(afterInstall.env).toEqual({ FOO: 'bar' });

    installer.uninstall();

    const afterUninstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(afterUninstall.env).toEqual({ FOO: 'bar' });
    expect(afterUninstall.hooks).toBeUndefined();
  });

  it('file watcher detects new files and reports relative paths', async () => {
    const watcher = createFileWatcher();
    const events: FileChangeEvent[] = [];
    watcher.onChange((e) => events.push(e));

    watcher.start(tmpDir);
    await wait(500);

    fs.writeFileSync(path.join(tmpDir, 'new-file.ts'), 'export const x = 1;');
    await wait(500);

    expect(events.length).toBeGreaterThanOrEqual(1);
    const added = events.find((e) => e.changeType === 'A');
    expect(added).toBeDefined();
    expect(added!.filePath).toBe('new-file.ts');

    await watcher.stop();
  });

  it('parser classifies PTY output into correct chunk types', () => {
    const parser = createParser();

    const thinking = parser.feed('⚡ Thinking...\nLet me analyze this.\n');
    expect(thinking).toHaveLength(2);
    expect(thinking[0]!.type).toBe('thinking');
    expect(thinking[1]!.type).toBe('thinking');

    const tool = parser.feed('Tool: Read src/index.ts\n');
    expect(tool).toHaveLength(1);
    expect(tool[0]!.type).toBe('mcp');
    expect(tool[0]!.toolName).toBe('Read');

    const file = parser.feed('Created: src/new-file.ts\n');
    expect(file).toHaveLength(1);
    expect(file[0]!.type).toBe('file');
    expect(file[0]!.fileOp).toBe('A');
  });

  it('full pipeline: hook events + PTY parsing both classify correctly', async () => {
    const server = createHookServer();
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const hookEvents: HookEvent[] = [];
    server.onEvent((e) => hookEvents.push(e));

    const parser = createParser();

    await sendToSocket(server.ipcPath, {
      hookType: 'PreToolUse',
      timestamp: Date.now(),
      payload: { tool_name: 'Edit', tool_input: { file_path: 'src/app.ts' } },
    });

    const ptyChunks = parser.feed('⏳ Edit src/app.ts\n✓ fs.edit (2 changes applied)\n');

    await wait(100);

    expect(hookEvents).toHaveLength(1);
    expect(hookEvents[0]!.type).toBe('tool_start');
    expect(hookEvents[0]!.toolName).toBe('Edit');

    expect(ptyChunks).toHaveLength(2);
    expect(ptyChunks[0]!.type).toBe('mcp');
    expect(ptyChunks[1]!.type).toBe('mcp');

    await server.stop();
  });

  it('multiple hook events in sequence are all received', async () => {
    const server = createHookServer();
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    for (let i = 0; i < 5; i++) {
      await sendToSocket(server.ipcPath, {
        hookType: 'PreToolUse',
        timestamp: Date.now(),
        payload: { tool_name: `Tool${i}` },
      });
      await wait(50);
    }

    await wait(200);
    expect(events).toHaveLength(5);
    events.forEach((e, i) => {
      expect(e.toolName).toBe(`Tool${i}`);
    });

    await server.stop();
  });

  it('hook installer does not corrupt pre-existing hooks', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    const settingsFile = path.join(tmpDir, '.claude', 'settings.local.json');

    const existingSettings = {
      hooks: {
        PreToolUse: [
          { type: 'command', command: 'my-custom-hook PreToolUse' },
        ],
      },
    };
    fs.writeFileSync(settingsFile, JSON.stringify(existingSettings, null, 2));

    const installer = createHookInstaller(tmpDir);
    installer.install('/tmp/test.sock', '/path/to/hook-forward.js');

    const afterInstall = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(afterInstall.hooks.PreToolUse).toHaveLength(2);
    expect(afterInstall.hooks.PreToolUse[0].command).toBe('my-custom-hook PreToolUse');

    installer.uninstall();
  });
});
