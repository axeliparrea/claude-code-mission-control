import { describe, it, expect } from 'vitest';
import { calculateLayout } from '../src/layout.js';
import type { LayoutResult } from '../src/layout.js';

function isPositiveRect(r: { width: number; height: number }): boolean {
  return r.width > 0 && r.height > 0;
}

describe('calculateLayout', () => {
  // --- Header ---

  it('header is always row 0, full width, height 1', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.header.top).toBe(0);
    expect(layout.header.left).toBe(0);
    expect(layout.header.width).toBe(120);
    expect(layout.header.height).toBe(1);
  });

  it('header width matches cols for any terminal size', () => {
    const layout = calculateLayout(200, 50, 'dual', 2);
    expect(layout.header.width).toBe(200);
  });

  // --- Input bar ---

  it('input is the last row of the left column in solo mode', () => {
    const rows = 40;
    const layout = calculateLayout(120, rows, 'solo', 0);
    expect(layout.input.top).toBe(rows - 1);
    expect(layout.input.height).toBe(1);
  });

  it('input is the last row of the left column in single mode', () => {
    const rows = 40;
    const layout = calculateLayout(120, rows, 'single', 1);
    expect(layout.input.top).toBe(rows - 1);
    expect(layout.input.height).toBe(1);
  });

  it('input left matches left column (0) in normal mode', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.input.left).toBe(0);
  });

  // --- Solo / no agents ---

  it('solo state: main fills left column', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.main.left).toBe(0);
    expect(layout.main.top).toBe(1);
    expect(isPositiveRect(layout.main)).toBe(true);
  });

  it('solo state: agents array is empty', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.agents).toHaveLength(0);
  });

  it('solo state: right column panes (thinking/mcp/files) are present with positive dimensions', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(isPositiveRect(layout.thinking)).toBe(true);
    expect(isPositiveRect(layout.mcp)).toBe(true);
    expect(isPositiveRect(layout.files)).toBe(true);
  });

  it('solo state with agentCount=0 is equivalent to solo state', () => {
    const layoutSolo = calculateLayout(120, 40, 'solo', 0);
    const layoutZeroAgents = calculateLayout(120, 40, 'single', 0);
    // Both should produce same main rect when agentCount=0
    expect(layoutZeroAgents.agents).toHaveLength(0);
    expect(layoutZeroAgents.main).toEqual(layoutSolo.main);
  });

  // --- Single agent ---

  it('single state: main shrinks and agent-1 appears below', () => {
    const layout = calculateLayout(120, 40, 'single', 1);
    expect(layout.main.height).toBeGreaterThan(0);
    expect(layout.agents).toHaveLength(1);
    const agent = layout.agents[0]!;
    expect(agent.top).toBeGreaterThan(layout.main.top);
    expect(agent.height).toBeGreaterThan(0);
  });

  it('single state: main top row is below header', () => {
    const layout = calculateLayout(120, 40, 'single', 1);
    expect(layout.main.top).toBe(1);
  });

  it('single state: agent pane starts where main ends', () => {
    const layout = calculateLayout(120, 40, 'single', 1);
    const agent = layout.agents[0]!;
    expect(agent.top).toBe(layout.main.top + layout.main.height);
  });

  it('single state: agent gets at least 5 rows, main gets the rest', () => {
    const rows = 40;
    const layout = calculateLayout(120, rows, 'single', 1);
    const contentHeight = rows - 2;
    const agentHeight = Math.max(5, Math.floor(contentHeight * 0.35));
    expect(layout.agents[0]!.height).toBe(agentHeight);
    expect(layout.main.height).toBe(contentHeight - agentHeight);
  });

  // --- Dual agents ---

  it('dual state: main shrinks further, two agents split the bottom', () => {
    const layout = calculateLayout(120, 40, 'dual', 2);
    expect(layout.main.height).toBeGreaterThan(0);
    expect(layout.agents).toHaveLength(2);
  });

  it('dual state: agent-1 and agent-2 are side by side', () => {
    const layout = calculateLayout(120, 40, 'dual', 2);
    const a1 = layout.agents[0]!;
    const a2 = layout.agents[1]!;
    expect(a1.top).toBe(a2.top);
    expect(a2.left).toBe(a1.left + a1.width);
  });

  it('dual state: combined agent widths equal left column width', () => {
    const cols = 120;
    const layout = calculateLayout(cols, 40, 'dual', 2);
    const rightWidth = Math.max(30, Math.floor(cols * 0.35));
    const leftWidth = cols - rightWidth;
    const a1 = layout.agents[0]!;
    const a2 = layout.agents[1]!;
    expect(a1.width + a2.width).toBe(leftWidth);
  });

  it('dual state: agents get at least 5 rows each, main gets the rest', () => {
    const rows = 40;
    const layout = calculateLayout(120, rows, 'dual', 2);
    const contentHeight = rows - 2;
    const agentArea = Math.max(5, Math.floor(contentHeight * 0.40));
    expect(layout.main.height).toBe(contentHeight - agentArea);
  });

  // --- Right column ---

  it('right column is approximately 35% of total width', () => {
    const cols = 120;
    const layout = calculateLayout(cols, 40, 'solo', 0);
    const expectedRightWidth = Math.max(30, Math.floor(cols * 0.35));
    expect(layout.thinking.width).toBe(expectedRightWidth);
    expect(layout.mcp.width).toBe(expectedRightWidth);
    expect(layout.files.width).toBe(expectedRightWidth);
  });

  it('right column starts at leftWidth (cols - rightWidth)', () => {
    const cols = 120;
    const layout = calculateLayout(cols, 40, 'solo', 0);
    const expectedRightWidth = Math.max(30, Math.floor(cols * 0.35));
    const expectedLeft = cols - expectedRightWidth;
    expect(layout.thinking.left).toBe(expectedLeft);
  });

  it('right column three panes are vertically stacked', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.thinking.top).toBeLessThan(layout.mcp.top);
    expect(layout.mcp.top).toBeLessThan(layout.files.top);
  });

  it('right column mcp starts where thinking ends', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.mcp.top).toBe(layout.thinking.top + layout.thinking.height);
  });

  it('right column files starts where mcp ends', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.files.top).toBe(layout.mcp.top + layout.mcp.height);
  });

  // --- Compact mode ---

  it('compact mode with cols < 60: no right column (zero rects)', () => {
    const layout = calculateLayout(50, 40, 'solo', 0);
    expect(layout.thinking.width).toBe(0);
    expect(layout.mcp.width).toBe(0);
    expect(layout.files.width).toBe(0);
  });

  it('compact mode with cols < 60: main takes full width', () => {
    const layout = calculateLayout(50, 40, 'solo', 0);
    expect(layout.main.width).toBe(50);
  });

  it('compact mode with rows < 15: no right column', () => {
    const layout = calculateLayout(120, 12, 'solo', 0);
    expect(layout.thinking.width).toBe(0);
    expect(layout.mcp.width).toBe(0);
    expect(layout.files.width).toBe(0);
  });

  it('compact mode with rows < 15: main takes full width', () => {
    const layout = calculateLayout(120, 12, 'solo', 0);
    expect(layout.main.width).toBe(120);
  });

  it('compact mode returns empty agents array', () => {
    const layout = calculateLayout(50, 40, 'dual', 2);
    expect(layout.agents).toHaveLength(0);
  });

  it('explicit compact layout state forces compact mode', () => {
    const layout = calculateLayout(200, 60, 'compact', 0);
    expect(layout.thinking.width).toBe(0);
    expect(layout.main.width).toBe(200);
  });

  it('compact mode: input is at last row', () => {
    const rows = 20;
    const layout = calculateLayout(120, rows, 'solo', 0);
    expect(layout.input.top).toBe(rows - 1);
  });

  // --- Edge cases ---

  it('all rects have non-negative width and height (no crash on small terminal)', () => {
    const layout = calculateLayout(10, 5, 'solo', 0);
    const rects = [layout.header, layout.main, layout.input];
    for (const rect of rects) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('very large terminal produces valid rects with positive dimensions', () => {
    const layout = calculateLayout(500, 200, 'dual', 2);
    const all = [
      layout.header, layout.main, layout.thinking, layout.mcp,
      layout.files, layout.input, ...layout.agents,
    ];
    for (const rect of all) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('agents array length matches agentCount for single', () => {
    const layout = calculateLayout(120, 40, 'single', 1);
    expect(layout.agents).toHaveLength(1);
  });

  it('agents array length matches agentCount for dual', () => {
    const layout = calculateLayout(120, 40, 'dual', 2);
    expect(layout.agents).toHaveLength(2);
  });

  it('left column width = total cols - right column width', () => {
    const cols = 150;
    const layout = calculateLayout(cols, 50, 'solo', 0);
    const rightWidth = layout.thinking.width;
    expect(layout.main.width).toBe(cols - rightWidth);
  });

  it('minimum right column width is 30 columns', () => {
    // With cols=100 exactly at threshold, layout is NOT compact (>=100)
    // but right column should be at least 30
    const layout = calculateLayout(100, 40, 'solo', 0);
    // 100 is not < 100, so should have right column
    expect(layout.thinking.width).toBeGreaterThanOrEqual(30);
  });
});
