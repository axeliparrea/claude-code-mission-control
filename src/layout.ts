/**
 * Calculates pane positions and sizes based on terminal dimensions and layout state.
 *
 * Layout: Main pane on top (full width), agent panes below (full width, grid).
 * No right column. Agents fill all available space below the main pane.
 *
 * @module layout
 */

import type { Rect, LayoutState } from './types.js';

const COMPACT_COLS_THRESHOLD = 60;
const COMPACT_ROWS_THRESHOLD = 15;

/**
 * Layout calculation result.
 */
export interface LayoutResult {
  header: Rect;
  main: Rect;
  thinking: Rect;
  mcp: Rect;
  files: Rect;
  agents: Rect[];
  input: Rect;
  rightTab: Rect;
  tabBar: Rect;
}

function zeroRect(): Rect {
  return { left: 0, top: 0, width: 0, height: 0 };
}

/**
 * Calculates a dynamic grid of agent panes filling the given area.
 * Columns = min(agentCount, maxCols). Rows = ceil(agentCount / cols).
 */
function buildAgentGrid(
  agentCount: number,
  left: number,
  top: number,
  width: number,
  height: number,
): Rect[] {
  if (agentCount === 0 || width < 4 || height < 3) return [];

  const maxCols = width >= 120 ? 3 : width >= 60 ? 2 : 1;
  const agentCols = Math.min(agentCount, maxCols);
  const agentRows = Math.ceil(agentCount / agentCols);
  const colWidth = Math.floor(width / agentCols);
  const rowHeight = Math.max(3, Math.floor(height / agentRows));

  const rects: Rect[] = [];
  for (let i = 0; i < agentCount; i++) {
    const col = i % agentCols;
    const row = Math.floor(i / agentCols);
    const isLastCol = col === agentCols - 1;
    const isLastRow = row === agentRows - 1;

    rects.push({
      left: left + col * colWidth,
      top: top + row * rowHeight,
      width: isLastCol ? width - col * colWidth : colWidth,
      height: isLastRow ? height - row * rowHeight : rowHeight,
    });
  }

  return rects;
}

/**
 * Calculates the layout.
 *
 * - Row 0: header (full width)
 * - Row 1 to (rows-2): main pane + agent panes (full width, stacked)
 * - Last row: input bar (full width)
 * - No agents: main takes full area
 * - With agents: main takes top portion, agents fill bottom in a grid
 */
export function calculateLayout(
  cols: number,
  rows: number,
  state: LayoutState,
  agentCount: number,
): LayoutResult {
  const isCompact =
    state === 'compact' ||
    cols < COMPACT_COLS_THRESHOLD ||
    rows < COMPACT_ROWS_THRESHOLD;

  const header: Rect = { left: 0, top: 0, width: cols, height: 1 };
  const input: Rect = { left: 0, top: rows - 1, width: cols, height: 1 };
  const empty = zeroRect();

  const contentTop = 1;
  const contentHeight = Math.max(1, rows - 2);

  if (isCompact || agentCount === 0) {
    const main: Rect = { left: 0, top: contentTop, width: cols, height: contentHeight };
    return {
      header, main,
      thinking: empty, mcp: empty, files: empty,
      agents: [],
      input, rightTab: empty, tabBar: empty,
    };
  }

  const agentRatio = agentCount === 1 ? 0.35 : agentCount <= 3 ? 0.45 : 0.55;
  const agentAreaHeight = Math.max(5, Math.floor(contentHeight * agentRatio));
  const mainHeight = contentHeight - agentAreaHeight;

  const main: Rect = { left: 0, top: contentTop, width: cols, height: mainHeight };
  const agentTop = contentTop + mainHeight;
  const agents = buildAgentGrid(agentCount, 0, agentTop, cols, agentAreaHeight);

  return {
    header, main,
    thinking: empty, mcp: empty, files: empty,
    agents, input,
    rightTab: empty, tabBar: empty,
  };
}
