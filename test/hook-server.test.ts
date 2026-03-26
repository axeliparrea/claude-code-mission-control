import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHookServer } from '../src/hooks/hook-server.js';
import type { HookServer, HookEvent } from '../src/hooks/hook-server.js';

/**
 * Generates a unique session ID for test isolation.
 */
function uniqueSessionId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Sends a newline-terminated JSON message to a Unix socket and disconnects.
 * @param socketPath - Path to the Unix domain socket
 * @param message - The object to serialise and send
 */
function sendToSocket(socketPath: string, message: unknown): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const client = net.createConnection(socketPath, () => {
      client.write(JSON.stringify(message) + '\n', (err) => {
        if (err) reject(err);
      });
    });

    client.on('close', () => resolve());
    client.on('error', reject);
  });
}

/**
 * Waits for async event propagation to settle.
 */
function settle(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('createHookServer', () => {
  let server: HookServer;

  beforeEach(() => {
    server = createHookServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('start() creates a socket and resolves', async () => {
    await expect(server.start(uniqueSessionId())).resolves.toBeUndefined();
  });

  it('stop() closes the server and cleans up the socket file', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);
    const socketPath = server.ipcPath;

    await server.stop();

    const { existsSync } = await import('node:fs');
    expect(existsSync(socketPath)).toBe(false);
  });

  it('receiving PreToolUse emits a tool_start event', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    await sendToSocket(server.ipcPath, {
      hookType: 'PreToolUse',
      timestamp: 1000,
      payload: { tool_name: 'Read', tool_input: { file: '/tmp/test' } },
    });
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('tool_start');
    expect(events[0]?.toolName).toBe('Read');
    expect(events[0]?.timestamp).toBe(1000);
    expect(events[0]?.toolInput).toEqual({ file: '/tmp/test' });
  });

  it('receiving PostToolUse emits a tool_end event', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    await sendToSocket(server.ipcPath, {
      hookType: 'PostToolUse',
      timestamp: 2000,
      payload: { tool_name: 'Write', tool_output: 'ok', tool_success: true },
    });
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('tool_end');
    expect(events[0]?.toolName).toBe('Write');
    expect(events[0]?.toolSuccess).toBe(true);
    expect(events[0]?.toolOutput).toBe('ok');
  });

  it('receiving PreToolUse with tool_name=Agent emits agent_spawn', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    await sendToSocket(server.ipcPath, {
      hookType: 'PreToolUse',
      timestamp: 3000,
      payload: {
        tool_name: 'Agent',
        tool_input: {
          agentType: 'coder11111',
          agentPrompt: 'implement X',
          agentModel: 'sonnet',
        },
      },
    });
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('agent_spawn');
    expect(events[0]?.agentType).toBe('coder11111');
    expect(events[0]?.agentPrompt).toBe('implement X');
    expect(events[0]?.agentModel).toBe('sonnet');
  });

  it('receiving PostToolUse with tool_name=Agent emits agent_done', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    await sendToSocket(server.ipcPath, {
      hookType: 'PostToolUse',
      timestamp: 4000,
      payload: {
        tool_name: 'Agent',
        tool_success: true,
        tool_output: { agentOutput: 'done', confidence: 95 },
      },
    });
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('agent_done');
    expect(events[0]?.toolSuccess).toBe(true);
    expect(events[0]?.agentOutput).toBe('done');
    expect(events[0]?.confidence).toBe(95);
  });

  it('receiving a Stop message emits a stop event', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    await sendToSocket(server.ipcPath, {
      hookType: 'Stop',
      timestamp: 5000,
      payload: {},
    });
    await settle();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('stop');
    expect(events[0]?.timestamp).toBe(5000);
  });

  it('malformed JSON is silently dropped', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(server.ipcPath, () => {
        client.write('this is not json\n', (err) => {
          if (err) reject(err);
        });
      });
      client.on('close', resolve);
      client.on('error', reject);
    });
    await settle();

    expect(events).toHaveLength(0);
  });

  it('multiple sequential connections all emit events', async () => {
    const sessionId = uniqueSessionId();
    const events: HookEvent[] = [];
    server.onEvent((e) => events.push(e));
    await server.start(sessionId);

    const hookTypes = ['PreToolUse', 'PostToolUse', 'Stop'] as const;
    for (const hookType of hookTypes) {
      await sendToSocket(server.ipcPath, {
        hookType,
        timestamp: 6000,
        payload: { tool_name: 'Read' },
      });
      await settle();
    }

    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe('tool_start');
    expect(events[1]?.type).toBe('tool_end');
    expect(events[2]?.type).toBe('stop');
  });

  it('ipcPath returns the correct path after start()', async () => {
    const sessionId = uniqueSessionId();
    await server.start(sessionId);

    const expected = path.join(os.tmpdir(), `mission-control-${sessionId}.sock`);
    expect(server.ipcPath).toBe(expected);
  });
});
