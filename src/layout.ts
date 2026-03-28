/**
 * Layout engine for Mission Control.
 *
 * Left column: Main pane (Claude Code terminal)
 * Right column: Agent panes (stacked vertically, dynamic count)
 * Bottom strip: Tab bar + active tab content (Tools/Files/Orch/Web)
 *
 * @module layout
 */

import type { Rect, LayoutState } from './types.js';

const COMPACT_COLS_THRESHOLD = 60;
const COMPACT_ROWS_THRESHOLD = 15;
const RIGHT_COL_MIN = 30;

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

  if (isCompact) {
    return {
      header,
      main: { left: 0, top: 1, width: cols, height: Math.max(1, rows - 2) },
      thinking: empty, mcp: empty, files: empty,
      agents: [], input,
      rightTab: empty, tabBar: empty,
    };
  }

  const contentTop = 1;
  const tabBarHeight = 1;
  const tabContentHeight = 5;
  const tabTotalHeight = tabBarHeight + tabContentHeight;

  const tabBarRect: Rect = { left: 0, top: rows - 1 - tabContentHeight - tabBarHeight, width: cols, height: 1 };
  const tabContentRect: Rect = { left: 0, top: rows - 1 - tabContentHeight, width: cols, height: tabContentHeight };

  const middleHeight = rows - 1 - 1 - tabTotalHeight;

  if (agentCount === 0) {
    return {
      header,
      main: { left: 0, top: contentTop, width: cols, height: middleHeight },
      thinking: empty, mcp: empty, files: empty,
      agents: [], input,
      rightTab: tabContentRect, tabBar: tabBarRect,
    };
  }

  const rightRatio = cols >= 120 ? 0.35 : 0.30;
  const rightWidth = Math.max(RIGHT_COL_MIN, Math.floor(cols * rightRatio));
  const leftWidth = cols - rightWidth;

  const main: Rect = { left: 0, top: contentTop, width: leftWidth, height: middleHeight };

  const agentAreaTop = contentTop;
  const agentAreaHeight = middleHeight;
  const agentRowHeight = Math.max(4, Math.floor(agentAreaHeight / Math.min(agentCount, 4)));

  const agents: Rect[] = [];
  for (let i = 0; i < agentCount; i++) {
    const isLast = i === agentCount - 1 || i === 3;
    agents.push({
      left: leftWidth,
      top: agentAreaTop + i * agentRowHeight,
      width: rightWidth,
      height: isLast ? agentAreaHeight - i * agentRowHeight : agentRowHeight,
    });
    if (i >= 3) break;
  }

  return {
    header, main,
    thinking: empty, mcp: empty, files: empty,
    agents, input,
    rightTab: tabContentRect, tabBar: tabBarRect,
  };
}
