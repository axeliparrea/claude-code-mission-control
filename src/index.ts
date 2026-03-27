#!/usr/bin/env node
/**
 * Claude Mission Control — terminal multiplexer entry point.
 * Wires PTY, hooks, file watcher, parser, layout, and pane renderers into
 * a single real-time TUI that surfaces Claude Code agents, thinking, tools,
 * and file changes as live side-panels alongside the main terminal.
 * @module index
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
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
import { createOrchestrator } from './orchestrator.js';
import { createProjectMemory } from './memory/project-memory.js';
import { createSessionCollector } from './memory/session-collector.js';
import { fg, bg, icons } from './theme.js';
import type { LayoutState, TrackedAgent, ParsedChunk, Rect } from './types.js';
import type { HookEvent } from './hooks/hook-server.js';

const TAB_NAMES = ['Tools', 'Files', 'Orch', 'Web'] as const;

const RENDER_INTERVAL_MS = 33;
const WINDOWS_RESIZE_POLL_MS = 500;
const MAX_VISIBLE_AGENT_PANES = 4;
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
 * Truncates a string and adds ellipsis if needed.
 */
function truncate(s: string, max: number): string {
  const clean = s.replace(/[\n\r]+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

/**
 * Extracts a readable preview from a tool input/output value.
 */
function previewValue(val: unknown, max = 60): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return truncate(val, max);
  try {
    return truncate(JSON.stringify(val), max);
  } catch {
    return '';
  }
}

/**
 * Formats a hook event into multiple display lines for the MCP pane.
 * Shows server name, tool input preview, and tool output preview.
 */
function formatHookToolLines(event: HookEvent): string[] {
  const lines: string[] = [];
  const name = truncate(event.toolName ?? 'tool', 25);
  const isMcp = event.serverName && event.serverName.length > 0;
  const serverBadge = isMcp
    ? ` ${fg.mcp}[${truncate(event.serverName!, 15)}]\x1b[0m`
    : '';
  const RESET = '\x1b[0m';

  if (event.type === 'tool_start') {
    lines.push(`${fg.thinking}${icons.pending}${RESET} ${name}${serverBadge}`);
  }

  if (event.type === 'tool_end') {
    const success = event.toolSuccess !== false;
    const icon = success ? `${fg.success}${icons.success}` : `${fg.error}${icons.error}`;
    lines.push(`${icon}${RESET} ${name}${serverBadge}`);
  }

  return lines;
}

/**
 * Determines the new layout state based on the number of active agent panes.
 */
function layoutStateForAgentCount(count: number): LayoutState {
  if (count === 0) return 'solo';
  if (count === 1) return 'single';
  return 'dual'; // 'dual' handles 2+ agents with dynamic grid
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
  const title = fg.textPrimary + ' Mission Control\x1b[0m';
  const agentsBadge = agentCount > 0
    ? ` ${greenDot} ${fg.success}${agentCount} agents\x1b[0m`
    : ` ${fg.textDim}0 agents\x1b[0m`;
  const toolsBadge = ` ${fg.textDim}${toolCount} tools\x1b[0m`;
  const filesBadge = fileCount > 0 ? ` ${fg.textDim}${fileCount} files\x1b[0m` : '';
  const hookBadge = hookConnected ? ` ${fg.success}hooks\x1b[0m` : '';
  const keybinds = ` ${fg.textDim}F1=panels q=quit\x1b[0m`;
  return ` ${dot}${title} │${agentsBadge} │${toolsBadge}${filesBadge}${hookBadge} │${keybinds}`;
}

/**
 * Main entry point — sets up the TUI and starts the render loop.
 */
/**
 * Resolves the working directory for Claude Code.
 * Accepts --cwd flag or defaults to process.cwd().
 */
function resolveWorkingDir(): string {
  const args = process.argv.slice(2);
  const cwdIndex = args.indexOf('--cwd');
  const cwdArg = cwdIndex !== -1 ? args[cwdIndex + 1] : undefined;
  if (cwdArg) {
    return path.resolve(cwdArg);
  }

  const firstArg = args.find((a) => !a.startsWith('-'));
  if (firstArg && fs.existsSync(firstArg)) {
    return path.resolve(firstArg);
  }

  return process.cwd();
}

async function main(): Promise<void> {
  enterAlternateScreen();
  hideCursor();

  const cwd = resolveWorkingDir();
  const sessionId = crypto.randomBytes(4).toString('hex');
  const { cols, rows } = termSize();

  const screen = createScreenBuffer(cols, rows);
  const ptyManager = createPtyManager();
  const parser = createParser();
  const hookServer = createHookServer();
  const hookInstaller = createHookInstaller(cwd);
  const fileWatcher = createFileWatcher();
  const projectMemory = createProjectMemory(cwd);
  const sessionCollector = createSessionCollector(projectMemory);

  projectMemory.load();
  hookInstaller.recoverFromCrash();

  let hookConnected = false;
  try {
    await hookServer.start(sessionId);
    const selfDir = path.dirname(new URL(import.meta.url).pathname);
    const hookInSrc = path.resolve(selfDir, 'hooks', 'hook-forward.mjs');
    const hookInDist = path.resolve(selfDir, 'hook-forward.mjs');
    const hookScriptPath = fs.existsSync(hookInSrc) ? hookInSrc : hookInDist;
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

  const toolsPane: TextPane = createTextPane('tools', 'Tools', layout.rightTab, fg.mcp, 300);
  const filesPane: TextPane = createTextPane('files', 'Files', layout.rightTab, fg.files, 50);
  const orchPane: TextPane = createTextPane('orch', 'Orchestrator', layout.rightTab, fg.agent, 500);
  const webPane: TextPane = createTextPane('web', 'Web', layout.rightTab, fg.main, 1000);
  const orchestrator = createOrchestrator();

  let activeTab = 0;
  const tabPanes: TextPane[] = [toolsPane, filesPane, orchPane, webPane];

  const agents = new Map<string, TrackedAgent>();
  const agentPanes = new Map<string, TextPane>();
  const agentSlotOrder: string[] = [];

  let panelMode = false;
  let focusedPaneIndex = 0;
  let toolCount = 0;
  let fileCount = 0;
  let screenDirty = true;

  function markDirty(): void {
    screenDirty = true;
  }
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
    markDirty();
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
    for (const tp of tabPanes) { tp.rect = layout.rightTab; }
    markDirty();

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
  /**
   * Returns the pane of the currently active (running) agent, if any.
   */
  function activeAgentPane(): TextPane | undefined {
    for (let i = agentSlotOrder.length - 1; i >= 0; i--) {
      const id = agentSlotOrder[i]!;
      const agent = agents.get(id);
      if (agent && agent.status === 'active') {
        return agentPanes.get(id);
      }
    }
    return undefined;
  }

  function routeChunk(chunk: ParsedChunk): void {
    sessionCollector.recordChunk(chunk);

    if (chunk.type === 'thinking') {
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
      const icon = chunk.toolStatus === 'success'
        ? `${fg.success}${icons.success}\x1b[0m`
        : chunk.toolStatus === 'error'
        ? `${fg.error}${icons.error}\x1b[0m`
        : `${fg.thinking}${icons.pending}\x1b[0m`;
      const name = chunk.toolName ?? 'tool';
      const server = chunk.toolServer ? ` ${fg.mcp}[${chunk.toolServer}]\x1b[0m` : '';
      const toolLine = `${icon} ${name}${server}`;
      toolsPane.appendLine(toolLine);
      const ap = activeAgentPane();
      if (ap) ap.appendLine(toolLine);
      return;
    }

    if (chunk.type === 'file') {
      fileCount += 1;
      const label = chunk.fileOp === 'A' ? `${fg.success}+` : chunk.fileOp === 'D' ? `${fg.error}-` : `${fg.main}M`;
      const fileLine = `${label}\x1b[0m ${chunk.filePath ?? ''}`;
      filesPane.appendLine(fileLine);
      const ap = activeAgentPane();
      if (ap) ap.appendLine(fileLine);
      return;
    }

    if (chunk.type === 'error') {
      toolsPane.appendLine(`${fg.error}${icons.error} ${chunk.clean}\x1b[0m`);
      const ap = activeAgentPane();
      if (ap) ap.appendLine(`${fg.error}${icons.error} ${chunk.clean}\x1b[0m`);
      return;
    }

    if (chunk.type === 'main') {
      const ap = activeAgentPane();
      if (ap) {
        const line = chunk.clean.trim();
        if (
          line.length > 10
          && !/^\s*[*·•]/.test(line)
          && !/thinking with \w+ effort/i.test(line)
          && !/^\s*[│┌┘└┐╭╮╯╰─]/.test(line)
          && !/bypasspermission|shift\+tab|Context\s+\d+%/i.test(line)
        ) {
          ap.appendLine(chunk.clean);
        }
      }
    }
  }

  /**
   * Routes a hook event to the appropriate pane.
   */
  function routeHookEvent(event: HookEvent): void {
    sessionCollector.recordHookEvent(event);
    orchestrator.handleEvent(event);

    if (event.type === 'tool_start' || event.type === 'tool_end') {
      toolCount += 1;
      const lines = formatHookToolLines(event);
      for (const line of lines) {
        toolsPane.appendLine(line);
      }
      const ap = activeAgentPane();
      if (ap) {
        for (const line of lines) { ap.appendLine(line); }
      }
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

    for (const id of agentSlotOrder) {
      agentPanes.get(id)?.renderTo(screen);
    }

    if (activeTab === 2) {
      orchPane.clear();
      for (const line of orchestrator.render()) { orchPane.appendLine(line); }
    }

    const tbr = layout.tabBar;
    if (tbr.width > 0) {
      let tabStr = '';
      for (let i = 0; i < TAB_NAMES.length; i++) {
        const label = `${i + 1}:${TAB_NAMES[i]}`;
        tabStr += i === activeTab
          ? `${fg.main}\x1b[1m ${label} \x1b[0m`
          : `${fg.textDim} ${label} \x1b[0m`;
        if (i < TAB_NAMES.length - 1) tabStr += `${fg.textDim}|`;
      }
      screen.writeAnsiString(tbr.top, tbr.left, tbr.width, bg.headerBg + tabStr + '\x1b[0m');
    }

    const activePane = tabPanes[activeTab];
    if (activePane && layout.rightTab.width > 0) {
      activePane.renderTo(screen);
    }

    const inputRow = r - 1;
    if (panelMode) {
      screen.writeAnsiString(inputRow, 0, c, `${fg.main}[PANEL]${fg.textDim} ↑↓=scroll tab=pane 1-4=tab F1=back\x1b[0m`);
    } else {
      screen.writeAnsiString(inputRow, 0, c, `${fg.textDim}${icons.dot} passthrough\x1b[0m`);
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

    if (key === '\x1bOP' || key === '\x1b[11~') {
      panelMode = !panelMode;
      if (panelMode) {
        focusedPaneIndex = 0;
      }
      applyFocus();
      return;
    }

    if (panelMode) {
      if (key >= '1' && key <= '4') {
        activeTab = parseInt(key) - 1;
        return;
      }
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

    try { sessionCollector.finalize(); } catch { }
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
    process.stdout.write('\x1b[2J');
    recalculateLayout();
    const contentCols = Math.max(1, layout.main.width - 2);
    const contentRows = Math.max(1, layout.main.height - 2);
    ptyManager.resize(contentCols, contentRows);
    renderFrame();
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
    sessionCollector.recordFileChange(event.filePath, event.changeType);
    const label = event.changeType === 'A' ? `${fg.success}+` : event.changeType === 'D' ? `${fg.error}-` : `${fg.main}M`;
    filesPane.appendLine(`${label}\x1b[0m ${event.filePath}`);
  });

  try {
    fileWatcher.start(cwd);
  } catch {
  }

  ptyManager.onData((data: string) => {
    mainPane.write(data);
    markDirty();
    const chunks = parser.feed(data);
    for (const chunk of chunks) {
      routeChunk(chunk);
    }
  });

  ptyManager.onExit((code: number) => {
    if (renderIntervalId !== null) clearInterval(renderIntervalId);
    renderFrame();
    setTimeout(() => {
      cleanup();
      process.exit(code);
    }, 1500);
  });

  const memoryContext = projectMemory.buildContext();
  if (memoryContext.length > 0) {
    const contextFile = path.join(projectMemory.memoryDir, 'CONTEXT.md');
    try {
      fs.mkdirSync(projectMemory.memoryDir, { recursive: true });
      fs.writeFileSync(contextFile, `# Project Memory (auto-generated by Mission Control)\n\n${memoryContext}\n`, 'utf8');
    } catch { }
  }

  const contentCols = Math.max(1, layout.main.width - 2);
  const contentRows = Math.max(1, layout.main.height - 2);
  ptyManager.spawn(contentCols, contentRows, cwd);

  renderFrame();
  renderIntervalId = setInterval(() => {
    if (screenDirty) {
      screenDirty = false;
      renderFrame();
    }
  }, RENDER_INTERVAL_MS);
}

main().catch((err: unknown) => {
  leaveAlternateScreen();
  showCursor();
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
