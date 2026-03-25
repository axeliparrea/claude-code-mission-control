#!/usr/bin/env node
/**
 * Claude Mission Control — terminal multiplexer entry point.
 * Wires the PTY manager, parser, layout engine, and pane renderers into a
 * single real-time TUI that surfaces Claude Code agents, thinking, tools,
 * and file changes as live side-panels alongside the main terminal.
 * @module index
 */

import { createScreenBuffer } from './screen.js';
import { createTerminalPane } from './terminal-pane.js';
import { createTextPane } from './text-pane.js';
import { createPtyManager } from './pty-manager.js';
import { createParser } from './parser.js';
import { calculateLayout } from './layout.js';
import { fg, bg, icons } from './theme.js';
import type { LayoutState, TrackedAgent, ParsedChunk, Rect } from './types.js';

type TextPane = ReturnType<typeof createTextPane>;
type TerminalPane = ReturnType<typeof createTerminalPane>;

const RENDER_INTERVAL_MS = 33;
const WINDOWS_RESIZE_POLL_MS = 500;
const MAX_VISIBLE_AGENT_PANES = 2;

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
  const path = chunk.filePath ?? '';
  const reset = '\x1b[0m';
  return `${opLabel}${reset} ${path}`;
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
function buildHeaderContent(agentCount: number, toolCount: number): string {
  const dot = fg.error + icons.dot + '\x1b[0m';
  const greenDot = fg.success + icons.dot + '\x1b[0m';
  const title = fg.textPrimary + ' Claude Mission Control\x1b[0m';
  const agentsBadge = ` ${greenDot} ${fg.textSecondary}${agentCount} agents\x1b[0m`;
  const toolsBadge = ` ${fg.textDim}${toolCount} tools\x1b[0m`;
  const keybinds = ` ${fg.textDim}tab=focus  q=quit\x1b[0m`;
  return ` ${dot}${title} │${agentsBadge} │${toolsBadge} │${keybinds}`;
}

/**
 * Main entry point — sets up the TUI and starts the render loop.
 */
async function main(): Promise<void> {
  enterAlternateScreen();
  hideCursor();

  const { cols, rows } = termSize();

  const screen = createScreenBuffer(cols, rows);
  const ptyManager = createPtyManager();
  const parser = createParser();

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
  );

  const mcpPane: TextPane = createTextPane(
    'mcp',
    'Tools',
    layout.mcp,
    fg.mcp,
  );

  const filesPane: TextPane = createTextPane(
    'files',
    'Files',
    layout.files,
    fg.files,
  );

  const agents = new Map<string, TrackedAgent>();
  const agentPanes = new Map<string, TextPane>();
  const agentSlotOrder: string[] = [];

  let focusedPaneIndex = 0;
  let inputBuffer = '';
  let inputMode = false;
  let toolCount = 0;
  let renderIntervalId: ReturnType<typeof setInterval> | null = null;
  let windowsPollId: ReturnType<typeof setInterval> | null = null;

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
      pane.focused = index === focusedPaneIndex;
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

    const pane = createTextPane(agentId, agentName, rect, fg.agent);
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
      filesPane.appendLine(formatFileChange(chunk));
      return;
    }

    if (chunk.type === 'error') {
      mcpPane.appendLine(`${fg.error}${icons.error} ${chunk.clean}\x1b[0m`);
      return;
    }
  }

  /**
   * Renders one complete frame into the screen buffer and flushes it.
   */
  function renderFrame(): void {
    const { cols: c, rows: r } = termSize();
    screen.clear();

    const headerContent = buildHeaderContent(agents.size, toolCount);
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
    const prompt = inputMode
      ? `${fg.main}>${fg.textSecondary} ${inputBuffer}█\x1b[0m`
      : `${fg.textDim}> ${inputBuffer}\x1b[0m`;
    screen.writeAnsiString(inputRow, 0, leftWidth, prompt);

    screen.flush(process.stdout);
  }

  /**
   * Processes raw keyboard input from stdin.
   */
  function handleKeyInput(data: Buffer): void {
    const key = data.toString('utf8');

    if (key === '\x03') {
      cleanup();
      process.exit(0);
    }

    if (key === 'q' && !inputMode) {
      cleanup();
      process.exit(0);
    }

    if (key === '\t') {
      const panes = focusablePanes();
      focusedPaneIndex = (focusedPaneIndex + 1) % panes.length;
      applyFocus();
      return;
    }

    if (key === '\x1b') {
      focusedPaneIndex = 0;
      applyFocus();
      inputMode = !inputMode;
      return;
    }

    if (key === '\r') {
      if (inputMode) {
        ptyManager.write(inputBuffer + '\r');
        inputBuffer = '';
      } else {
        ptyManager.write('\r');
      }
      return;
    }

    if (key === '\x7f') {
      if (inputMode && inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
      }
      return;
    }

    if (key === '\x1b[A') {
      if (!inputMode) {
        const panes = focusablePanes();
        panes[focusedPaneIndex]?.scrollUp?.();
      }
      return;
    }

    if (key === '\x1b[B') {
      if (!inputMode) {
        const panes = focusablePanes();
        panes[focusedPaneIndex]?.scrollDown?.();
      }
      return;
    }

    if (inputMode) {
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        inputBuffer += key;
      }
    } else {
      ptyManager.write(key);
    }
  }

  /**
   * Tears down the TUI, kills the PTY, and restores the terminal.
   */
  function cleanup(): void {
    if (renderIntervalId !== null) clearInterval(renderIntervalId);
    if (windowsPollId !== null) clearInterval(windowsPollId);

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
    const { cols: c, rows: r } = termSize();
    const contentCols = Math.max(1, layout.main.width - 2);
    const contentRows = Math.max(1, layout.main.height - 2);
    ptyManager.resize(contentCols, contentRows);
    screen.resize(c, r);
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
        screen.resize(c, r);
      }
    }, WINDOWS_RESIZE_POLL_MS);
  }

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
