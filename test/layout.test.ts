import { describe, it, expect } from 'vitest';
import { calculateLayout } from '../src/layout.js';

describe('calculateLayout', () => {
  it('header is at row 0 full width', () => {
    const l = calculateLayout(120, 40, 'solo', 0);
    expect(l.header).toEqual({ left: 0, top: 0, width: 120, height: 1 });
  });

  it('input bar at last row', () => {
    const l = calculateLayout(120, 40, 'solo', 0);
    expect(l.input.top).toBe(39);
  });

  it('solo: main takes full width, no agents', () => {
    const l = calculateLayout(120, 40, 'solo', 0);
    expect(l.main.width).toBe(120);
    expect(l.agents).toHaveLength(0);
  });

  it('with agents: main on left, agents on right', () => {
    const l = calculateLayout(120, 40, 'single', 1);
    expect(l.main.left).toBe(0);
    expect(l.agents[0]!.left).toBeGreaterThan(0);
    expect(l.main.width + l.agents[0]!.width).toBe(120);
  });

  it('agents stacked vertically on the right', () => {
    const l = calculateLayout(120, 40, 'dual', 3);
    expect(l.agents).toHaveLength(3);
    for (let i = 1; i < l.agents.length; i++) {
      expect(l.agents[i]!.top).toBeGreaterThan(l.agents[i - 1]!.top);
    }
    expect(l.agents[0]!.left).toBe(l.agents[1]!.left);
  });

  it('tab bar exists below the main area', () => {
    const l = calculateLayout(120, 40, 'solo', 0);
    expect(l.tabBar.width).toBe(120);
    expect(l.tabBar.top).toBeLessThan(l.input.top);
  });

  it('tab content below tab bar', () => {
    const l = calculateLayout(120, 40, 'solo', 0);
    expect(l.rightTab.top).toBe(l.tabBar.top + 1);
    expect(l.rightTab.width).toBe(120);
  });

  it('compact: main only', () => {
    const l = calculateLayout(50, 12, 'dual', 3);
    expect(l.agents).toHaveLength(0);
    expect(l.main.width).toBe(50);
  });

  it('max 4 agent panes visible', () => {
    const l = calculateLayout(120, 40, 'dual', 6);
    expect(l.agents.length).toBeLessThanOrEqual(4);
  });

  it('agent panes have at least 4 rows each', () => {
    const l = calculateLayout(120, 50, 'dual', 3);
    for (const a of l.agents) {
      expect(a.height).toBeGreaterThanOrEqual(4);
    }
  });

  it('right column at least 30 cols', () => {
    const l = calculateLayout(80, 40, 'single', 1);
    expect(l.agents[0]!.width).toBeGreaterThanOrEqual(30);
  });
});
