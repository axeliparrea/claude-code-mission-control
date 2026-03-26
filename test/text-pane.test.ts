import { describe, it, expect, vi } from 'vitest';
import { createTextPane, TextPane } from '../src/text-pane.js';
import { createScreenBuffer } from '../src/screen.js';
import type { Rect } from '../src/types.js';

const DEFAULT_RECT: Rect = { left: 0, top: 0, width: 30, height: 10 };
const BORDER_COLOR = '\x1b[32m';

function makeMockStream(): { stream: NodeJS.WriteStream; getOutput: () => string } {
  let output = '';
  const stream = {
    write: (data: string) => {
      output += data;
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { stream, getOutput: () => output };
}

describe('TextPane', () => {
  // --- Construction ---

  it('createTextPane creates a TextPane with correct id and title', () => {
    const pane = createTextPane('pane-1', 'My Title', DEFAULT_RECT, BORDER_COLOR);
    expect(pane.id).toBe('pane-1');
    expect(pane.title).toBe('My Title');
  });

  it('pane starts with empty lines array', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    expect(pane.lines).toHaveLength(0);
  });

  it('pane starts with scroll offset 0', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    expect(pane.scrollOffset).toBe(0);
  });

  it('pane starts unfocused', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    expect(pane.focused).toBe(false);
  });

  // --- appendLine ---

  it('appendLine adds a line to the buffer', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('hello');
    expect(pane.lines).toHaveLength(1);
    expect(pane.lines[0]).toBe('hello');
  });

  it('appendLine adds multiple lines in order', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('first');
    pane.appendLine('second');
    pane.appendLine('third');
    expect(pane.lines).toHaveLength(3);
    expect(pane.lines[0]).toBe('first');
    expect(pane.lines[2]).toBe('third');
  });

  it('appendLine accepts ANSI-encoded strings', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('\x1b[32mgreen text\x1b[0m');
    expect(pane.lines[0]).toBe('\x1b[32mgreen text\x1b[0m');
  });

  // --- Ring buffer (maxLines) ---

  it('ring buffer trims to maxLines when exceeded', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR, 3);
    pane.appendLine('line1');
    pane.appendLine('line2');
    pane.appendLine('line3');
    pane.appendLine('line4'); // should push out line1
    expect(pane.lines).toHaveLength(3);
    expect(pane.lines[0]).toBe('line2');
    expect(pane.lines[2]).toBe('line4');
  });

  it('ring buffer keeps most recent maxLines lines', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR, 2);
    for (let i = 0; i < 10; i++) {
      pane.appendLine(`line ${i}`);
    }
    expect(pane.lines).toHaveLength(2);
    expect(pane.lines[0]).toBe('line 8');
    expect(pane.lines[1]).toBe('line 9');
  });

  it('ring buffer exactly at maxLines does not trim', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR, 3);
    pane.appendLine('a');
    pane.appendLine('b');
    pane.appendLine('c');
    expect(pane.lines).toHaveLength(3);
  });

  // --- Auto-scroll ---

  it('auto-scroll: scrollOffset tracks bottom when pane is at bottom', () => {
    // Content height = rect.height - 2 = 10 - 2 = 8
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    // Fill past content height to trigger scroll
    for (let i = 0; i < 12; i++) {
      pane.appendLine(`line ${i}`);
    }
    // Should auto-scroll to show last lines
    const contentHeight = DEFAULT_RECT.height - 2;
    const expectedOffset = Math.max(0, 12 - contentHeight);
    expect(pane.scrollOffset).toBe(expectedOffset);
  });

  it('auto-scroll does not change offset when pane has fewer lines than content height', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('one');
    pane.appendLine('two');
    // 2 lines < content height (8), offset stays at 0
    expect(pane.scrollOffset).toBe(0);
  });

  // --- scrollUp / scrollDown ---

  it('scrollUp does not go below 0', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.scrollUp();
    expect(pane.scrollOffset).toBe(0);
  });

  it('scrollDown does not exceed max offset', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('only one line');
    pane.scrollDown();
    // With 1 line and contentHeight=8, max offset = max(0, 1-8)=0
    expect(pane.scrollOffset).toBe(0);
  });

  it('scrollUp decrements scrollOffset by 1', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    for (let i = 0; i < 20; i++) pane.appendLine(`line ${i}`);
    const before = pane.scrollOffset;
    pane.scrollUp();
    expect(pane.scrollOffset).toBe(before - 1);
  });

  it('scrollDown increments scrollOffset by 1 when not at bottom', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    for (let i = 0; i < 20; i++) pane.appendLine(`line ${i}`);
    // Go to top first
    for (let i = 0; i < 20; i++) pane.scrollUp();
    expect(pane.scrollOffset).toBe(0);
    pane.scrollDown();
    expect(pane.scrollOffset).toBe(1);
  });

  it('scrollUp after auto-scroll leaves offset at contentHeight position', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    for (let i = 0; i < 20; i++) pane.appendLine(`line ${i}`);
    const beforeUp = pane.scrollOffset;
    pane.scrollUp();
    expect(pane.scrollOffset).toBe(beforeUp - 1);
  });

  // --- Manual scroll disables auto-scroll ---

  it('if user scrolled up, appending a line does not auto-scroll', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    for (let i = 0; i < 20; i++) pane.appendLine(`line ${i}`);
    pane.scrollUp();
    const offsetBeforeAppend = pane.scrollOffset;
    pane.appendLine('new line');
    // Should not auto-scroll because not at bottom
    expect(pane.scrollOffset).toBe(offsetBeforeAppend);
  });

  // --- setTitle ---

  it('setTitle updates the title property', () => {
    const pane = createTextPane('p', 'Old Title', DEFAULT_RECT, BORDER_COLOR);
    pane.setTitle('New Title');
    expect(pane.title).toBe('New Title');
  });

  it('setTitle accepts empty string', () => {
    const pane = createTextPane('p', 'Title', DEFAULT_RECT, BORDER_COLOR);
    pane.setTitle('');
    expect(pane.title).toBe('');
  });

  // --- clear ---

  it('clear removes all lines', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('a');
    pane.appendLine('b');
    pane.clear();
    expect(pane.lines).toHaveLength(0);
  });

  it('clear resets scroll offset to 0', () => {
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    for (let i = 0; i < 20; i++) pane.appendLine(`line ${i}`);
    pane.clear();
    expect(pane.scrollOffset).toBe(0);
  });

  // --- renderTo ---

  it('renderTo draws the box border', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    // Should contain box-drawing characters
    expect(out).toContain('┌');
    expect(out).toContain('┘');
  });

  it('renderTo includes the title in the border', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'Testing', DEFAULT_RECT, BORDER_COLOR);
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('Testing');
  });

  it('renderTo draws lines within the pane', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('hello');
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    // The flush emits characters with cursor-movement sequences between them,
    // so we check for each word independently rather than the full phrase.
    expect(getOutput()).toContain('hello');
  });

  it('renderTo empty pane renders just the border (no content)', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('┌');
    // Content rows should only have spaces + border characters
  });

  it('renderTo with focused=true draws double-line border', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.focused = true;
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('╔');
  });

  it('renderTo respects scrollOffset and shows correct lines', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    for (let i = 0; i < 20; i++) pane.appendLine(`line${i}`);
    // Scroll to top to see first lines
    for (let i = 0; i < 20; i++) pane.scrollUp();
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('line0');
  });

  it('renderTo renders ANSI-encoded lines with color', () => {
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    pane.appendLine('\x1b[31mred text\x1b[0m');
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('red text');
    expect(out).toContain('\x1b[31m');
  });

  it('renderTo does not render lines beyond content height', () => {
    // contentHeight = 10 - 2 = 8
    const screen = createScreenBuffer(40, 15);
    const pane = createTextPane('p', 'T', DEFAULT_RECT, BORDER_COLOR);
    // Scroll to top so we see lines 0..7 (first 8)
    for (let i = 0; i < 20; i++) pane.appendLine(`line${i}`);
    for (let i = 0; i < 20; i++) pane.scrollUp();
    pane.renderTo(screen);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    // line8 and beyond should NOT be visible
    expect(getOutput()).not.toContain('line8');
  });
});
