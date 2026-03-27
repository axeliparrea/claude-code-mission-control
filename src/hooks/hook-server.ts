/**
 * Unix domain socket IPC server that receives JSON messages from Claude Code hook scripts.
 * @module hook-server
 */

import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

/**
 * Raw message format received from hook-forward.js scripts over the IPC socket.
 */
interface HookMessage {
  hookType: 'PreToolUse' | 'PostToolUse' | 'Stop';
  timestamp: number;
  payload: {
    tool_name?: string;
    tool_input?: unknown;
    tool_output?: unknown;
    tool_success?: boolean;
    server_name?: string;
    session_id?: string;
  };
}

/**
 * Normalised event emitted to consumers after converting a raw {@link HookMessage}.
 */
export interface HookEvent {
  type: 'tool_start' | 'tool_end' | 'agent_spawn' | 'agent_done' | 'stop';
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  toolSuccess?: boolean;
  serverName?: string;
  agentType?: string;
  agentPrompt?: string;
  agentModel?: string;
  agentOutput?: string;
  confidence?: number;
  timestamp: number;
}

/**
 * Callback invoked whenever a {@link HookEvent} is received.
 */
export type HookEventCallback = (event: HookEvent) => void;

/**
 * Manages an IPC socket server that listens for hook messages from Claude Code.
 */
export interface HookServer {
  /**
   * Starts the server and begins listening on the IPC path derived from the given session ID.
   * @param sessionId - Unique session identifier used to construct the socket path
   * @returns Resolves when the server is ready to accept connections
   */
  start(sessionId: string): Promise<void>;

  /**
   * Stops the server and removes the socket file from the filesystem.
   * @returns Resolves when the server has fully closed
   */
  stop(): Promise<void>;

  /**
   * Registers a callback to be invoked for each incoming {@link HookEvent}.
   * @param callback - Function called with the parsed event
   */
  onEvent(callback: HookEventCallback): void;

  /** The filesystem path (or named pipe name on Windows) the server is bound to. */
  readonly ipcPath: string;
}

/**
 * Derives the platform-appropriate IPC path for a given session ID.
 * On Windows this is a named pipe; on all other platforms it is a Unix socket file in the OS temp directory.
 * @param sessionId - Unique session identifier
 * @returns The fully-qualified IPC path string
 */
function getIpcPath(sessionId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\mission-control-${sessionId}`;
  }
  return path.join(os.tmpdir(), `mission-control-${sessionId}.sock`);
}

/**
 * Attempts to remove a socket file if it exists on non-Windows platforms.
 * @param socketPath - Filesystem path to the socket file
 */
function removeSocketFile(socketPath: string): void {
  if (process.platform === 'win32') {
    return;
  }
  try {
    fs.unlinkSync(socketPath);
  } catch {
  }
}

/**
 * Parses a raw JSON string into a {@link HookMessage}, returning null if the input
 * cannot be parsed or does not conform to the expected shape.
 * @param raw - Raw JSON string received over the socket
 * @returns A validated HookMessage or null
 */
function parseHookMessage(raw: string): HookMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('hookType' in parsed) ||
    !('timestamp' in parsed) ||
    !('payload' in parsed)
  ) {
    return null;
  }

  const msg = parsed as Record<string, unknown>;
  const hookType = msg['hookType'];

  if (
    hookType !== 'PreToolUse' &&
    hookType !== 'PostToolUse' &&
    hookType !== 'Stop'
  ) {
    return null;
  }

  return parsed as HookMessage;
}

/**
 * Extracts agent-specific fields from a tool_input object, guarding against
 * non-object values.
 * @param toolInput - Arbitrary tool_input value from the hook payload
 * @returns Partial agent spawn metadata
 */
function extractAgentSpawnFields(toolInput: unknown): Pick<HookEvent, 'agentType' | 'agentPrompt' | 'agentModel'> {
  if (typeof toolInput !== 'object' || toolInput === null) {
    return {};
  }
  const input = toolInput as Record<string, unknown>;
  return {
    agentType: typeof input['agentType'] === 'string' ? input['agentType'] : undefined,
    agentPrompt: typeof input['agentPrompt'] === 'string' ? input['agentPrompt'] : undefined,
    agentModel: typeof input['agentModel'] === 'string' ? input['agentModel'] : undefined,
  };
}

/**
 * Extracts agent-specific fields from a tool_output object, guarding against
 * non-object values.
 * @param toolOutput - Arbitrary tool_output value from the hook payload
 * @returns Partial agent done metadata
 */
function extractAgentDoneFields(toolOutput: unknown): Pick<HookEvent, 'agentOutput' | 'confidence'> {
  if (typeof toolOutput !== 'object' || toolOutput === null) {
    return {};
  }
  const output = toolOutput as Record<string, unknown>;
  return {
    agentOutput: typeof output['agentOutput'] === 'string' ? output['agentOutput'] : undefined,
    confidence: typeof output['confidence'] === 'number' ? output['confidence'] : undefined,
  };
}

/**
 * Converts a validated {@link HookMessage} into a normalised {@link HookEvent}.
 * @param message - The incoming hook message to convert
 * @returns The corresponding HookEvent
 */
function convertToHookEvent(message: HookMessage): HookEvent {
  const { hookType, timestamp, payload } = message;
  const isAgentTool = payload.tool_name === 'Agent';

  if (hookType === 'Stop') {
    return { type: 'stop', timestamp };
  }

  if (hookType === 'PreToolUse') {
    if (isAgentTool) {
      return {
        type: 'agent_spawn',
        toolName: payload.tool_name,
        serverName: payload.server_name,
        timestamp,
        ...extractAgentSpawnFields(payload.tool_input),
      };
    }
    return {
      type: 'tool_start',
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      serverName: payload.server_name,
      timestamp,
    };
  }

  if (isAgentTool) {
    return {
      type: 'agent_done',
      toolName: payload.tool_name,
      toolSuccess: payload.tool_success,
      serverName: payload.server_name,
      timestamp,
      ...extractAgentDoneFields(payload.tool_output),
    };
  }

  return {
    type: 'tool_end',
    toolName: payload.tool_name,
    toolOutput: payload.tool_output,
    toolSuccess: payload.tool_success,
    serverName: payload.server_name,
    timestamp,
  };
}

/**
 * Creates a new {@link HookServer} instance.
 * The server is not started until {@link HookServer.start} is called.
 *
 * @returns A ready-to-configure HookServer
 */
export function createHookServer(): HookServer {
  let server: net.Server | null = null;
  let resolvedIpcPath = '';
  const eventCallbacks: HookEventCallback[] = [];

  function emitEvent(event: HookEvent): void {
    for (const cb of eventCallbacks) {
      cb(event);
    }
  }

  function handleConnection(socket: net.Socket): void {
    let buffer = '';

    socket.setEncoding('utf8');

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 65536) {
        socket.destroy();
        return;
      }
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }
      const raw = buffer.slice(0, newlineIndex).trim();
      socket.destroy();

      const message = parseHookMessage(raw);
      if (message === null) {
        return;
      }
      emitEvent(convertToHookEvent(message));
    });

    socket.on('error', () => {
      socket.destroy();
    });
  }

  return {
    get ipcPath(): string {
      return resolvedIpcPath;
    },

    start(sessionId: string): Promise<void> {
      resolvedIpcPath = getIpcPath(sessionId);
      removeSocketFile(resolvedIpcPath);

      return new Promise<void>((resolve, reject) => {
        server = net.createServer(handleConnection);

        server.on('error', reject);

        server.listen(resolvedIpcPath, () => {
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        if (server === null) {
          resolve();
          return;
        }
        server.close((err) => {
          server = null;
          removeSocketFile(resolvedIpcPath);
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },

    onEvent(callback: HookEventCallback): void {
      eventCallbacks.push(callback);
    },
  };
}
