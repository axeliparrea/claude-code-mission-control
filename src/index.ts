#!/usr/bin/env node
/**
 * Claude Mission Control — terminal multiplexer entry point.
 * Wires PTY, hooks, file watcher, parser, layout, and pane renderers into
 * a single real-time TUI that surfaces Claude Code agents, thinking, tools,
 * and file changes as live side-panels alongside the main terminal.
 * @module index
 */

import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createScreenBuffer } from './screen.js';
import { createTerminalPane } from './terminal-pane.js';
import { createTextPane, TextPane } from './text-pane.js';
import { TerminalPane } from './terminal-pane.js';
import { createPtyManager } from './pty-manager.js';
import { createParser } from './parser.js';
import { calculateLayout } from './layout.js';
import { createHookServer } from './hooks/hook-server.js';
import { createHookInstaller } from './hooks/hook-installer.js';
import { createFileWatcher } from './watchers/file-watcher.js';
import { fg, bg, icons } from './theme.js';
import type { LayoutState, TrackedAgent, ParsedChunk, Rect } from './types.js';
import type { HookEvent } from './hooks/hook-server.js';

const RENDER_INTERVAL_MS = 33;
const WINDOWS_RESIZE_POLL_MS = 500;
const MAX_VISIBLE_AGENT_PANES = 2;
const DOUBLE_CTRLC_MS = 500;

/**
 * Emits the ANSI escape sequence to enter the alternate screen buffer.
 */
function enterAlternateScreen(): void {
  process.stdout.write('\x1b[?1049h');
}

/**
 * Emits the ANSI escape sequence to leave the alternate screen buffer.
 */
function leaveAlternateScreen(): void {
  process.stdout.write('\x1b[?1049l');
}

/**
 * Hides the terminal cursor.
 */
function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

/**
 * Shows the terminal cursor.
 */
function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

/**
 * Returns the current terminal dimensions, with safe fallbacks.
 */
function termSize(): { cols: number; rows: number } {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/**
 * Formats a tool call chunk into a displayable string for the MCP pane.
 */
function formatToolCall(chunk: ParsedChunk): string {
  const icon = chunk.toolStatus === 'success'
    ? icons.success
    : chunk.toolStatus === 'error'
    ? icons.error
    : icons.pending;
  const name = chunk.toolName ?? 'tool';
  const server = chunk.toolServer ? ` (${chunk.toolServer})` : '';
  return `${icon} ${name}${server}`;
}

/**
 * Formats a file-change chunk into a displayable string for the files pane.
 */
function formatFileChange(chunk: ParsedChunk): string {
  const opLabel = chunk.fileOp === 'A' ? fg.success + '+' : chunk.fileOp === 'D' ? fg.error + '-' : fg.main + 'M';
  const filePath = chunk.filePath ?? '';
  const reset = '\x1b[0m';
  return `${opLabel}${reset} ${filePath}`;
}

/**
 * Formats a hook event tool into a displayable string for the MCP pane.
 */
function formatHookTool(event: HookEvent): string {
  const icon = event.type === 'tool_end'
    ? (event.toolSuccess !== false ? icons.success : icons.error)
    : icons.pending;
  const name = event.toolName ?? 'tool';
  const server = event.serverName ? ` (${event.serverName})` : '';
  return `${icon} ${name}${server}`;
}

/**
 * Determines the new layout state based on the number of active agent panes.
 */
function layoutStateForAgentCount(count: number): LayoutState {
  if (count === 0) return 'solo';
  if (count === 1) return 'single';
  return 'dual';
}

/**
 * Finds the oldest agent with status 'done' to evict when the slot limit is reached.
 */
function findEvictableAgent(agents: Map<string, TrackedAgent>): string | null {
  for (const [id, agent] of agents) {
    if (agent.status === 'done') return id;
  }
  return null;
}

/**
 * Builds the header bar content string.
 */
function buildHeaderContent(
  agentCount: number,
  toolCount: number,
  fileCount: number,
  hookConnected: boolean,
): string {
  const dot = fg.error + icons.dot + '\x1b[0m';
  const greenDot = fg.success + icons.dot + '\x1b[0m';
  const title = fg.textPrimary + ' Claude Mission Control\x1b[0m';
  const agentsBadge = ` ${greenDot} ${fg.textSecondary}${agentCount} agents\x1b[0m`;
  const toolsBadge = ` ${fg.textDim}${toolCount} tools\x1b[0m`;
  const filesBadge = ` ${fg.textDim}${fileCount} files\x1b[0m`;
  const hookBadge = hookConnected
    ? ` ${fg.success}hooks${'\x1b[0m'}`
    : ` ${fg.textDim}hooks:off${'\x1b[0m'}`;
  const keybinds = ` ${fg.textDim}esc=panels  q=quit\x1b[0m`;
  return ` ${dot}${title} │${agentsBadge} │${toolsBadge} │${filesBadge} │${hookBadge} │${keybinds}`;
}

/**
 * Main entry point — sets up the TUI and starts the render loop.
 */
async function main(): Promise<void> {
  enterAlternateScreen();
  hideCursor();

  const cwd = process.cwd();
  const sessionId = crypto.randomBytes(4).toString('hex');
  const { cols, rows } = termSize();

  const screen = createScreenBuffer(cols, rows);
  const ptyManager = createPtyManager();
  const parser = createParser();
  const hookServer = createHookServer();
  const hookInstaller = createHookInstaller(cwd);
  const fileWatcher = createFileWatcher();

  hookInstaller.recoverFromCrash();

  let hookConnected = false;
  try {
    await hookServer.start(sessionId);
    const hookScriptPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      'hooks',
      'hook-forward.js',
    );
    hookInstaller.install(hookServer.ipcPath, hookScriptPath);
    hookConnected = true;
  } catch {
    hookConnected = false;
  }

  let layoutState: LayoutState = 'solo';
  let layout = calculateLayout(cols, rows, layoutState, 0);

  const mainPane: TerminalPane = createTerminalPane(
    'main',
    'Claude Code',
    layout.main,
    fg.main,
  );

  const thinkingPane: TextPane = createTextPane(
    'thinking',
    'Thinking',
    layout.thinking,
    fg.thinking,
    200,
  );

  const mcpPane: TextPane = createTextPane(
    'mcp',
    'Tools',
    layout.mcp,
    fg.mcp,
    300,
  );

  const filesPane: TextPane = createTextPane(
    'files',
    'Files',
    layout.files,
    fg.files,
    50,
  );

  const agents = new Map<string, TrackedAgent>();
  const agentPanes = new Map<string, TextPane>();
  const agentSlotOrder: string[] = [];

  let panelMode = false;
  let focusedPaneIndex = 0;
  let toolCount = 0;
  let fileCount = 0;
  let lastCtrlCTime = 0;
  let renderIntervalId: ReturnType<typeof setInterval> | null = null;
  let windowsPollId: ReturnType<typeof setInterval> | null = null;
  let hookAgentCounter = 0;

  /**
   * Returns the ordered list of focusable panes (main + agents + thinking).
   */
  function focusablePanes(): Array<TerminalPane | TextPane> {
    const panes: Array<TerminalPane | TextPane> = [mainPane];
    for (const id of agentSlotOrder) {
      const pane = agentPanes.get(id);
      if (pane) panes.push(pane);
    }
    panes.push(thinkingPane);
    return panes;
  }

  /**
   * Applies focus state to the currently selected pane and clears all others.
   */
  function applyFocus(): void {
    const panes = focusablePanes();
    panes.forEach((pane, index) => {
      pane.focused = panelMode && index === focusedPaneIndex;
    });
  }

  applyFocus();

  /**
   * Recalculates layout and resizes all panes to match current terminal size.
   */
  function recalculateLayout(): void {
    const { cols: c, rows: r } = termSize();
    screen.resize(c, r);
    layout = calculateLayout(c, r, layoutState, agentSlotOrder.length);

    mainPane.resize(layout.main);
    thinkingPane.rect = layout.thinking;
    mcpPane.rect = layout.mcp;
    filesPane.rect = layout.files;

    layout.agents.forEach((rect, index) => {
      const agentId = agentSlotOrder[index];
      if (agentId) {
        const pane = agentPanes.get(agentId);
        if (pane) pane.rect = rect;
      }
    });
  }

  /**
   * Creates a TextPane for a newly detected agent and registers it.
   */
  function registerAgent(agentId: string, agentName: string): void {
    const visibleCount = agentSlotOrder.length;

    if (visibleCount >= MAX_VISIBLE_AGENT_PANES) {
      const evictId = findEvictableAgent(agents);
      if (evictId) {
        agentSlotOrder.splice(agentSlotOrder.indexOf(evictId), 1);
        agentPanes.delete(evictId);
        agents.delete(evictId);
      } else {
        return;
      }
    }

    const agent: TrackedAgent = {
      id: agentId,
      name: agentName,
      status: 'active',
      slot: agentSlotOrder.length,
      lines: [],
    };

    agents.set(agentId, agent);
    agentSlotOrder.push(agentId);

    const newCount = agentSlotOrder.length;
    layoutState = layoutStateForAgentCount(newCount);
    recalculateLayout();

    const slotIndex = agentSlotOrder.indexOf(agentId);
    const rect: Rect = layout.agents[slotIndex] ?? { left: 0, top: 0, width: 0, height: 0 };

    const pane = createTextPane(agentId, agentName, rect, fg.agent, 500);
    agentPanes.set(agentId, pane);
    applyFocus();
  }

  /**
   * Routes a parsed chunk to the appropriate side pane.
   */
  function routeChunk(chunk: ParsedChunk): void {
    if (chunk.type === 'thinking') {
      thinkingPane.appendLine(chunk.clean);
      return;
    }

    if (chunk.type === 'agent') {
      const agentId = chunk.agentId;
      if (!agentId) return;

      if (chunk.agentName && !agents.has(agentId)) {
        registerAgent(agentId, chunk.agentName);
        return;
      }

      const existingAgent = agents.get(agentId);
      if (existingAgent) {
        if (/done|complete|finished|returned/i.test(chunk.clean)) {
          existingAgent.status = 'done';
          const pane = agentPanes.get(agentId);
          if (pane) pane.borderColor = fg.textDim;
        } else {
          existingAgent.lines.push(chunk.clean);
          agentPanes.get(agentId)?.appendLine(chunk.clean);
        }
      }
      return;
    }

    if (chunk.type === 'mcp') {
      toolCount += 1;
      mcpPane.appendLine(formatToolCall(chunk));
      return;
    }

    if (chunk.type === 'file') {
      fileCount += 1;
      filesPane.appendLine(formatFileChange(chunk));
      return;
    }

    if (chunk.type === 'error') {
      mcpPane.appendLine(`${fg.error}${icons.error} ${chunk.clean}\x1b[0m`);
      return;
    }
  }

  /**
   * Routes a hook event to the appropriate pane.
   */
  function routeHookEvent(event: HookEvent): void {
    if (event.type === 'tool_start' || event.type === 'tool_end') {
      toolCount += 1;
      mcpPane.appendLine(formatHookTool(event));
      return;
    }

    if (event.type === 'agent_spawn') {
      hookAgentCounter += 1;
      const agentId = `hook-agent-${hookAgentCounter}`;
      const agentName = event.agentType ?? event.toolName ?? 'Agent';
      registerAgent(agentId, agentName);
      if (event.agentPrompt) {
        agentPanes.get(agentId)?.appendLine(
          `${fg.textDim}${icons.arrow} ${event.agentPrompt.slice(0, 120)}\x1b[0m`
        );
      }
      return;
    }

    if (event.type === 'agent_done') {
      const lastAgentId = agentSlotOrder[agentSlotOrder.length - 1];
      if (lastAgentId) {
        const existingAgent = agents.get(lastAgentId);
        if (existingAgent) {
          existingAgent.status = 'done';
          const pane = agentPanes.get(lastAgentId);
          if (pane) {
            pane.borderColor = fg.textDim;
            if (event.agentOutput) {
              pane.appendLine(`${fg.success}${icons.success} done\x1b[0m`);
            }
          }
        }
      }
      return;
    }
  }

  /**
   * Renders one complete frame into the screen buffer and flushes it.
   */
  function renderFrame(): void {
    const { cols: c, rows: r } = termSize();
    screen.clear();

    const headerContent = buildHeaderContent(agents.size, toolCount, fileCount, hookConnected);
    screen.writeAnsiString(0, 0, c, bg.headerBg + headerContent + '\x1b[0m');

    mainPane.renderTo(screen);
    thinkingPane.renderTo(screen);
    mcpPane.renderTo(screen);
    filesPane.renderTo(screen);

    for (const id of agentSlotOrder) {
      agentPanes.get(id)?.renderTo(screen);
    }

    const inputRow = r - 1;
    const leftWidth = layout.input.width;
    if (panelMode) {
      const hint = `${fg.main}[PANEL MODE]${fg.textDim} ↑↓=scroll tab=next esc=back\x1b[0m`;
      screen.writeAnsiString(inputRow, 0, leftWidth, hint);
    } else {
      const prompt = `${fg.textDim}${icons.dot} passthrough\x1b[0m`;
      screen.writeAnsiString(inputRow, 0, leftWidth, prompt);
    }

    screen.flush(process.stdout);
  }

  /**
   * Processes raw keyboard input from stdin.
   * Default mode: passthrough to PTY (real terminal experience).
   * Panel mode: navigate and scroll panes.
   */
  function handleKeyInput(data: Buffer): void {
    const key = data.toString('utf8');

    if (key === '\x03') {
      const now = Date.now();
      if (now - lastCtrlCTime < DOUBLE_CTRLC_MS) {
        cleanup();
        process.exit(0);
      }
      lastCtrlCTime = now;
      ptyManager.write(key);
      return;
    }

    if (key === '\x1b' && data.length === 1) {
      panelMode = !panelMode;
      if (panelMode) {
        focusedPaneIndex = 0;
      }
      applyFocus();
      return;
    }

    if (panelMode) {
      if (key === 'q') {
        cleanup();
        process.exit(0);
      }

      if (key === '\t') {
        const panes = focusablePanes();
        focusedPaneIndex = (focusedPaneIndex + 1) % panes.length;
        applyFocus();
        return;
      }

      if (key === '\x1b[A') {
        const panes = focusablePanes();
        panes[focusedPaneIndex]?.scrollUp?.();
        return;
      }

      if (key === '\x1b[B') {
        const panes = focusablePanes();
        panes[focusedPaneIndex]?.scrollDown?.();
        return;
      }

      return;
    }

    ptyManager.write(key);
  }

  /**
   * Tears down the TUI, kills the PTY, and restores the terminal.
   */
  function cleanup(): void {
    if (renderIntervalId !== null) clearInterval(renderIntervalId);
    if (windowsPollId !== null) clearInterval(windowsPollId);

    try { hookInstaller.uninstall(); } catch { }
    try { hookServer.stop(); } catch { }
    try { fileWatcher.stop(); } catch { }
    try { ptyManager.kill(); } catch { }

    if (process.stdin.isTTY) {
      try { process.stdin.setRawMode(false); } catch { }
    }

    process.stdin.pause();
    showCursor();
    leaveAlternateScreen();
  }

  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();
  process.stdin.on('data', handleKeyInput);

  process.stdout.on('resize', () => {
    recalculateLayout();
    const contentCols = Math.max(1, layout.main.width - 2);
    const contentRows = Math.max(1, layout.main.height - 2);
    ptyManager.resize(contentCols, contentRows);
  });

  if (process.platform === 'win32') {
    let lastCols = cols;
    let lastRows = rows;
    windowsPollId = setInterval(() => {
      const { cols: c, rows: r } = termSize();
      if (c !== lastCols || r !== lastRows) {
        lastCols = c;
        lastRows = r;
        recalculateLayout();
        const contentCols = Math.max(1, layout.main.width - 2);
        const contentRows = Math.max(1, layout.main.height - 2);
        ptyManager.resize(contentCols, contentRows);
      }
    }, WINDOWS_RESIZE_POLL_MS);
  }

  hookServer.onEvent((event: HookEvent) => {
    routeHookEvent(event);
  });

  fileWatcher.onChange((event) => {
    fileCount += 1;
    const opLabel = event.changeType === 'A'
      ? fg.success + '+'
      : event.changeType === 'D'
      ? fg.error + '-'
      : fg.main + 'M';
    filesPane.appendLine(`${opLabel}\x1b[0m ${event.filePath}`);
  });

  fileWatcher.start(cwd);

  ptyManager.onData((data: string) => {
    mainPane.write(data);
    const chunks = parser.feed(data);
    for (const chunk of chunks) {
      routeChunk(chunk);
    }
  });

  ptyManager.onExit((code: number) => {
    if (renderIntervalId !== null) clearInterval(renderIntervalId);
    mcpPane.appendLine(`${fg.textDim}Process exited (${code})\x1b[0m`);
    renderFrame();
    setTimeout(() => {
      cleanup();
      process.exit(code);
    }, 1500);
  });

  const contentCols = Math.max(1, layout.main.width - 2);
  const contentRows = Math.max(1, layout.main.height - 2);
  ptyManager.spawn(contentCols, contentRows);

  renderIntervalId = setInterval(renderFrame, RENDER_INTERVAL_MS);
}

main().catch((err: unknown) => {
  leaveAlternateScreen();
  showCursor();
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
