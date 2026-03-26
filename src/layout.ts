/**
 * Calculates pane positions and sizes based on terminal dimensions and layout state.
 * @module layout
 */

import type { Rect, LayoutState } from './types.js';

/** Minimum column count for the right sidebar to be shown. */
const RIGHT_COLUMN_MIN_COLS = 30;

/** Fraction of total width allocated to the right column. */
const RIGHT_COLUMN_RATIO = 0.35;

/** Compact layout threshold in columns. */
const COMPACT_COLS_THRESHOLD = 100;

/** Compact layout threshold in rows. */
const COMPACT_ROWS_THRESHOLD = 25;

/**
 * The result of a layout calculation, containing the {@link Rect} for every
 * named pane region.  Agent panes are listed in slot order.
 */
export interface LayoutResult {
  /** Full-width header bar at row 0. */
  header: Rect;
  /** Main (Claude Code terminal) pane on the left column. */
  main: Rect;
  /** Thinking content pane — top third of right column. */
  thinking: Rect;
  /** Tool-call / MCP pane — middle third of right column. */
  mcp: Rect;
  /** File-change pane — bottom third of right column. */
  files: Rect;
  /** Zero, one, or two agent panes below the main pane. */
  agents: Rect[];
  /** Single-row input bar at the bottom of the left column. */
  input: Rect;
  /** Full right column rect for tabbed single-pane mode (row 2 to bottom). */
  rightTab: Rect;
  /** Tab bar row at the top of the right column. */
  tabBar: Rect;
}

/**
 * Produces a zero-size {@link Rect} positioned at the origin.
 * Used to represent hidden panes without breaking callers that inspect the rect.
 */
function zeroRect(): Rect {
  return { left: 0, top: 0, width: 0, height: 0 };
}

/**
 * Splits the right column into three equal vertical thirds.
 * When the column height is not perfectly divisible the last section absorbs
 * any remainder rows.
 */
function splitRightColumn(rightLeft: number, rightTop: number, rightWidth: number, rightHeight: number): [Rect, Rect, Rect] {
  const third = Math.floor(rightHeight / 3);
  const remainder = rightHeight - third * 3;

  const thinking: Rect = {
    left: rightLeft,
    top: rightTop,
    width: rightWidth,
    height: third,
  };

  const mcp: Rect = {
    left: rightLeft,
    top: rightTop + third,
    width: rightWidth,
    height: third,
  };

  const files: Rect = {
    left: rightLeft,
    top: rightTop + third * 2,
    width: rightWidth,
    height: third + remainder,
  };

  return [thinking, mcp, files];
}

/**
 * Calculates the complete layout for a given terminal size and state.
 *
 * Layout regions:
 * - Row 0 is always the header bar (full width).
 * - The bottom row of the left column is always the input bar.
 * - The right column is 35% of total width (≥ 30 cols) and spans rows 1–bottom.
 * - The left column fills the remaining width.
 * - Agent panes appear below the main pane in the left column.
 *
 * Compact mode (< 100 cols OR < 25 rows) collapses the right column and gives
 * the main pane the full width.
 *
 * @param cols - Current terminal width in columns
 * @param rows - Current terminal height in rows
 * @param state - Active layout state controlling how agents are positioned
 * @param agentCount - Number of currently active agent panes (0, 1, or 2)
 * @returns A {@link LayoutResult} with computed {@link Rect} values for every pane
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

  if (isCompact) {
    const mainHeight = Math.max(1, Math.floor(rows * 0.7) - 1);
    const main: Rect = {
      left: 0,
      top: 1,
      width: cols,
      height: mainHeight,
    };
    const input: Rect = {
      left: 0,
      top: rows - 1,
      width: cols,
      height: 1,
    };

    return {
      header,
      main,
      thinking: zeroRect(),
      mcp: zeroRect(),
      files: zeroRect(),
      agents: [],
      input,
      rightTab: zeroRect(),
      tabBar: zeroRect(),
    };
  }

  const rightWidth = Math.max(RIGHT_COLUMN_MIN_COLS, Math.floor(cols * RIGHT_COLUMN_RATIO));
  const leftWidth = cols - rightWidth;
  const rightTop = 1;
  const rightHeight = rows - 1;

  const [thinking, mcp, files] = splitRightColumn(leftWidth, rightTop, rightWidth, rightHeight);

  const tabBar: Rect = { left: leftWidth, top: 1, width: rightWidth, height: 1 };
  const rightTab: Rect = { left: leftWidth, top: 2, width: rightWidth, height: rows - 2 };

  const input: Rect = {
    left: 0,
    top: rows - 1,
    width: leftWidth,
    height: 1,
  };

  const leftContentTop = 1;
  const leftContentBottom = rows - 2;
  const leftContentHeight = leftContentBottom - leftContentTop + 1;

  if (state === 'solo' || agentCount === 0) {
    const main: Rect = {
      left: 0,
      top: leftContentTop,
      width: leftWidth,
      height: leftContentHeight,
    };

    return { header, main, thinking, mcp, files, agents: [], input, rightTab, tabBar };
  }

  if (state === 'single' || agentCount === 1) {
    const mainHeight = Math.max(1, Math.floor(leftContentHeight * 0.55));
    const agentHeight = leftContentHeight - mainHeight;

    const main: Rect = {
      left: 0,
      top: leftContentTop,
      width: leftWidth,
      height: mainHeight,
    };

    const agent1: Rect = {
      left: 0,
      top: leftContentTop + mainHeight,
      width: leftWidth,
      height: agentHeight,
    };

    return { header, main, thinking, mcp, files, agents: [agent1], input, rightTab, tabBar };
  }

  const mainHeight = Math.max(1, Math.floor(leftContentHeight * 0.45));
  const agentAreaHeight = leftContentHeight - mainHeight;
  const agentWidth = Math.floor(leftWidth / 2);
  const agent2Width = leftWidth - agentWidth;

  const main: Rect = {
    left: 0,
    top: leftContentTop,
    width: leftWidth,
    height: mainHeight,
  };

  const agent1: Rect = {
    left: 0,
    top: leftContentTop + mainHeight,
    width: agentWidth,
    height: agentAreaHeight,
  };

  const agent2: Rect = {
    left: agentWidth,
    top: leftContentTop + mainHeight,
    width: agent2Width,
    height: agentAreaHeight,
  };

  return { header, main, thinking, mcp, files, agents: [agent1, agent2], input, rightTab, tabBar };
}
