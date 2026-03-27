import { describe, it, expect } from 'vitest';
import { calculateLayout } from '../src/layout.js';

describe('calculateLayout', () => {
  it('header is always at row 0 with full width', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.header).toEqual({ left: 0, top: 0, width: 120, height: 1 });
  });

  it('input bar is always at the last row', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.input.top).toBe(39);
    expect(layout.input.width).toBe(120);
  });

  it('solo state: main takes full content area', () => {
    const layout = calculateLayout(120, 40, 'solo', 0);
    expect(layout.main.left).toBe(0);
    expect(layout.main.top).toBe(1);
    expect(layout.main.width).toBe(120);
    expect(layout.main.height).toBe(38);
    expect(layout.agents).toHaveLength(0);
  });

  it('single agent: main + 1 agent pane stacked vertically', () => {
    const layout = calculateLayout(120, 40, 'single', 1);
    expect(layout.main.width).toBe(120);
    expect(layout.agents).toHaveLength(1);
    expect(layout.agents[0]!.width).toBe(120);
    expect(layout.main.height + layout.agents[0]!.height).toBe(38);
  });

  it('single agent: agent pane has at least 5 rows', () => {
    const layout = calculateLayout(120, 40, 'single', 1);
    expect(layout.agents[0]!.height).toBeGreaterThanOrEqual(5);
  });

  it('dual agents: 2 panes side by side below main', () => {
    const layout = calculateLayout(120, 40, 'dual', 2);
    expect(layout.agents).toHaveLength(2);
    const a1 = layout.agents[0]!;
    const a2 = layout.agents[1]!;
    expect(a1.top).toBe(a2.top);
    expect(a1.width + a2.width).toBe(120);
  });

  it('3 agents at 120 cols: 3 columns in one row', () => {
    const layout = calculateLayout(120, 40, 'dual', 3);
    expect(layout.agents).toHaveLength(3);
    expect(layout.agents[0]!.top).toBe(layout.agents[1]!.top);
    expect(layout.agents[1]!.top).toBe(layout.agents[2]!.top);
  });

  it('4 agents at 100 cols: 2x2 grid', () => {
    const layout = calculateLayout(100, 40, 'dual', 4);
    expect(layout.agents).toHaveLength(4);
    expect(layout.agents[0]!.left).toBe(0);
    expect(layout.agents[1]!.left).toBeGreaterThan(0);
    expect(layout.agents[2]!.top).toBeGreaterThan(layout.agents[0]!.top);
  });

  it('wide terminal (180+): 3 agents in 3 columns', () => {
    const layout = calculateLayout(180, 40, 'dual', 3);
    expect(layout.agents).toHaveLength(3);
    expect(layout.agents[0]!.left).toBe(0);
    expect(layout.agents[1]!.left).toBe(60);
    expect(layout.agents[2]!.left).toBe(120);
  });

  it('agents use full terminal width', () => {
    const layout = calculateLayout(100, 30, 'dual', 2);
    const a1 = layout.agents[0]!;
    const a2 = layout.agents[1]!;
    expect(a1.width + a2.width).toBe(100);
  });

  it('more agents = more area ratio for agents', () => {
    const l1 = calculateLayout(120, 40, 'single', 1);
    const l4 = calculateLayout(120, 40, 'dual', 4);
    expect(l4.agents[0]!.top).toBeLessThan(l1.agents[0]!.top);
  });

  it('compact mode (< 60 cols): main only, no agents', () => {
    const layout = calculateLayout(50, 40, 'dual', 3);
    expect(layout.agents).toHaveLength(0);
    expect(layout.main.width).toBe(50);
  });

  it('compact mode (< 15 rows): main only', () => {
    const layout = calculateLayout(120, 12, 'solo', 0);
    expect(layout.main.width).toBe(120);
    expect(layout.agents).toHaveLength(0);
  });

  it('explicit compact state: main only', () => {
    const layout = calculateLayout(200, 60, 'compact', 5);
    expect(layout.agents).toHaveLength(0);
    expect(layout.main.width).toBe(200);
  });

  it('agent panes are positioned below main', () => {
    const layout = calculateLayout(120, 40, 'dual', 2);
    const mainBottom = layout.main.top + layout.main.height;
    expect(layout.agents[0]!.top).toBe(mainBottom);
  });

  it('all panes fit within terminal bounds', () => {
    const layout = calculateLayout(80, 25, 'dual', 4);
    for (const agent of layout.agents) {
      expect(agent.left + agent.width).toBeLessThanOrEqual(80);
      expect(agent.top + agent.height).toBeLessThanOrEqual(24);
    }
    expect(layout.main.top + layout.main.height).toBeLessThanOrEqual(24);
  });

  it('6 agents: grid with at least 3 rows height each', () => {
    const layout = calculateLayout(120, 50, 'dual', 6);
    expect(layout.agents).toHaveLength(6);
    for (const a of layout.agents) {
      expect(a.height).toBeGreaterThanOrEqual(3);
    }
  });
});
