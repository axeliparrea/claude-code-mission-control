/**
 * Hook flow tests — validates the complete hook lifecycle:
 * install hooks → start server → send events → receive events → cleanup.
 * Simulates what happens when Claude Code runs inside Mission Control.
 * @module test/mcp/hook-flow
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { createHookServer } from '../../src/hooks/hook-server.js';
import { createHookInstaller } from '../../src/hooks/hook-installer.js';
import type { HookEvent } from '../../src/hooks/hook-server.js';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueSessionId(): string {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Simulates what hook-forward.js does: connects to socket, sends JSON, disconnects.
 */
function simulateHookForward(
  ipcPath: string,
  hookType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(ipcPath, () => {
      client.write(JSON.stringify({
        hookType,
        timestamp: Date.now(),
        payload,
      }) + '\n');
      client.end();
    });
    client.on('close', () => resolve());
    client.on('error', reject);
  });
}

describe('Hook lifecycle flow', { timeout: 10000 }, () => {
  let tmpDir: string;
  let server: ReturnType<typeof createHookServer>;
  let installer: ReturnType<typeof createHookInstaller>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hook-flow-'));
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.claude', 'settings.local.json'),
      JSON.stringify({}, null, 2),
    );

    server = createHookServer();
    installer = createHookInstaller(tmpDir);
  });

  afterEach(async () => {
    installer.uninstall();
    await server.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('complete lifecycle: install → start → events → stop → uninstall', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const hookScriptPath = path.resolve('src/hooks/hook-forward.js');
    installer.install(server.ipcPath, hookScriptPath);

    const settingsFile = path.join(tmpDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.PreToolUse).toHaveLength(1);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    await simulateHookForward(server.ipcPath, 'PreToolUse', {
      tool_name: 'Read',
      tool_input: { file_path: 'package.json' },
    });
    await wait(100);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('tool_start');
    expect(events[0]!.toolName).toBe('Read');

    await simulateHookForward(server.ipcPath, 'PostToolUse', {
      tool_name: 'Read',
      tool_output: '{"name":"my-project"}',
      tool_success: true,
    });
    await wait(100);

    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe('tool_end');
    expect(events[1]!.toolSuccess).toBe(true);

    installer.uninstall();

    const restoredSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    expect(restoredSettings.hooks).toBeUndefined();

    await server.stop();
  });

  it('agent spawn → agent done lifecycle via hooks', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    await simulateHookForward(server.ipcPath, 'PreToolUse', {
      tool_name: 'Agent',
      tool_input: {
        agentType: 'Explore',
        agentPrompt: 'Find all API endpoints',
        agentModel: 'sonnet',
      },
    });
    await wait(100);

    expect(events[0]!.type).toBe('agent_spawn');
    expect(events[0]!.agentType).toBe('Explore');
    expect(events[0]!.agentPrompt).toBe('Find all API endpoints');
    expect(events[0]!.agentModel).toBe('sonnet');

    await simulateHookForward(server.ipcPath, 'PostToolUse', {
      tool_name: 'Agent',
      tool_output: {
        agentOutput: 'Found 12 API endpoints across 4 route files',
        confidence: 95,
      },
      tool_success: true,
    });
    await wait(100);

    expect(events[1]!.type).toBe('agent_done');
    expect(events[1]!.agentOutput).toBe('Found 12 API endpoints across 4 route files');
    expect(events[1]!.confidence).toBe(95);
  });

  it('rapid-fire tool events are all received in order', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    const toolNames = ['Read', 'Glob', 'Edit', 'Bash', 'Write', 'Grep', 'WebFetch', 'Read', 'Edit', 'Bash'];

    for (const toolName of toolNames) {
      await simulateHookForward(server.ipcPath, 'PreToolUse', {
        tool_name: toolName,
        tool_input: {},
      });
      await wait(20);
    }

    await wait(300);

    expect(events).toHaveLength(toolNames.length);
    events.forEach((event, i) => {
      expect(event.type).toBe('tool_start');
      expect(event.toolName).toBe(toolNames[i]);
    });
  });

  it('Stop hook event is received', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    await simulateHookForward(server.ipcPath, 'Stop', {});
    await wait(100);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('stop');
  });

  it('malformed JSON from hook-forward is silently dropped', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));

    await new Promise<void>((resolve) => {
      const client = net.createConnection(server.ipcPath, () => {
        client.write('not valid json at all\n');
        client.end();
      });
      client.on('close', () => resolve());
      client.on('error', () => resolve());
    });

    await wait(100);
    expect(events).toHaveLength(0);

    await simulateHookForward(server.ipcPath, 'PreToolUse', {
      tool_name: 'Read',
      tool_input: {},
    });
    await wait(100);

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('tool_start');
  });
});
