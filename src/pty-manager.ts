/**
 * Manages a Claude Code pseudo-terminal process via node-pty.
 * @module pty-manager
 */

import * as nodePty from 'node-pty';

/** Callback invoked when PTY produces output data. */
type DataCallback = (data: string) => void;

/** Callback invoked when the PTY process exits. */
type ExitCallback = (code: number) => void;

/**
 * Controls a spawned pseudo-terminal process, providing
 * data I/O, resize, and lifecycle management.
 */
export interface PtyManager {
  /**
   * Spawns the Claude Code process inside a pseudo-terminal.
   * @param cols - Initial terminal width in columns
   * @param rows - Initial terminal height in rows
   * @param cwd - Working directory for the spawned process; defaults to process.cwd()
   */
  spawn(cols: number, rows: number, cwd?: string): void;

  /**
   * Writes raw data to the PTY stdin.
   * @param data - String data to send
   */
  write(data: string): void;

  /**
   * Resizes the PTY window.
   * @param cols - New terminal width in columns
   * @param rows - New terminal height in rows
   */
  resize(cols: number, rows: number): void;

  /** Kills the PTY process. */
  kill(): void;

  /**
   * Registers a handler for PTY output data.
   * @param callback - Function called with each data chunk emitted by the PTY
   */
  onData(callback: DataCallback): void;

  /**
   * Registers a handler for PTY process exit.
   * @param callback - Function called with the exit code when the process ends
   */
  onExit(callback: ExitCallback): void;
}

/**
 * Resolves the command and arguments to use when spawning Claude Code.
 * Falls back to the `claude` binary if no CLI args override it.
 */
function resolveCommand(): { command: string; args: string[] } {
  const cliArgs = process.argv.slice(2);
  const filtered: string[] = [];
  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === '--cwd') {
      i++;
      continue;
    }
    filtered.push(cliArgs[i]!);
  }
  return { command: 'claude', args: filtered };
}

/**
 * Builds the environment object for the spawned PTY process,
 * ensuring colour output is forced and TERM is set appropriately.
 */
function buildEnv(): Record<string, string> {
  const termValue = process.platform === 'win32' ? 'cygwin' : 'xterm-256color';
  return {
    ...process.env as Record<string, string>,
    FORCE_COLOR: '1',
    TERM: termValue,
  };
}

/**
 * Normalises line endings on Windows by replacing CR+LF sequences
 * with LF so downstream consumers deal with a single convention.
 */
function normaliseLineEndings(data: string): string {
  if (process.platform === 'win32') {
    return data.replace(/\r\n/g, '\n');
  }
  return data;
}

/**
 * Creates and returns a new {@link PtyManager} instance.
 * The process is not spawned until {@link PtyManager.spawn} is called.
 *
 * @returns A ready-to-use PtyManager
 */
export function createPtyManager(): PtyManager {
  let ptyProcess: nodePty.IPty | null = null;
  const dataCallbacks: DataCallback[] = [];
  const exitCallbacks: ExitCallback[] = [];

  function emitData(data: string): void {
    const normalised = normaliseLineEndings(data);
    for (const cb of dataCallbacks) {
      cb(normalised);
    }
  }

  function emitExit(code: number): void {
    for (const cb of exitCallbacks) {
      cb(code);
    }
  }

  return {
    spawn(cols: number, rows: number, cwd?: string): void {
      const { command, args } = resolveCommand();
      const env = buildEnv();
      const workingDir = cwd ?? process.cwd();

      ptyProcess = nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: workingDir,
        env,
      });

      ptyProcess.onData((data: string) => {
        emitData(data);
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        emitExit(exitCode);
      });
    },

    write(data: string): void {
      ptyProcess?.write(data);
    },

    resize(cols: number, rows: number): void {
      ptyProcess?.resize(cols, rows);
    },

    kill(): void {
      ptyProcess?.kill();
      ptyProcess = null;
    },

    onData(callback: DataCallback): void {
      dataCallbacks.push(callback);
    },

    onExit(callback: ExitCallback): void {
      exitCallbacks.push(callback);
    },
  };
}
