import { describe, it, expect, vi } from 'vitest';
import { createScreenBuffer } from '../src/screen.js';
import { ATTR_BOLD } from '../src/types.js';

/** Creates a minimal mock WriteStream that captures written data. */
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

describe('createScreenBuffer', () => {
  // --- Constructor / dimensions ---

  it('reports correct cols and rows', () => {
    const screen = createScreenBuffer(80, 24);
    expect(screen.cols).toBe(80);
    expect(screen.rows).toBe(24);
  });

  // --- put ---

  it('put stores a character at the given position', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'X');
    // Verify by flushing and checking output contains the character
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('X');
  });

  it('put with out-of-bounds row is a no-op (no crash)', () => {
    const screen = createScreenBuffer(10, 5);
    expect(() => screen.put(99, 0, 'X')).not.toThrow();
    expect(() => screen.put(-1, 0, 'X')).not.toThrow();
  });

  it('put with out-of-bounds col is a no-op (no crash)', () => {
    const screen = createScreenBuffer(10, 5);
    expect(() => screen.put(0, 99, 'X')).not.toThrow();
    expect(() => screen.put(0, -1, 'X')).not.toThrow();
  });

  it('put stores fg, bg and attrs', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'A', '\x1b[31m', '\x1b[44m', ATTR_BOLD);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('A');
    expect(out).toContain('\x1b[31m');
    expect(out).toContain('\x1b[44m');
  });

  // --- writeString ---

  it('writeString writes multiple characters sequentially', () => {
    const screen = createScreenBuffer(20, 5);
    const written = screen.writeString(0, 0, 'hello');
    expect(written).toBe(5);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('hello');
  });

  it('writeString respects column boundary and stops at edge', () => {
    const screen = createScreenBuffer(5, 5);
    const written = screen.writeString(0, 3, 'hello');
    // only 2 chars fit (cols 3 and 4)
    expect(written).toBe(2);
  });

  it('writeString returns 0 for empty string', () => {
    const screen = createScreenBuffer(10, 5);
    expect(screen.writeString(0, 0, '')).toBe(0);
  });

  it('writeString applies fg, bg and attrs to all characters', () => {
    const screen = createScreenBuffer(20, 5);
    screen.writeString(0, 0, 'AB', '\x1b[32m', '', ATTR_BOLD);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('\x1b[32m');
    expect(out).toContain('A');
    expect(out).toContain('B');
  });

  // --- writeAnsiString ---

  it('writeAnsiString parses ANSI and writes styled cells', () => {
    const screen = createScreenBuffer(20, 5);
    const written = screen.writeAnsiString(0, 0, 10, '\x1b[31mhello\x1b[0m');
    expect(written).toBe(5);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('hello');
    expect(out).toContain('\x1b[31m');
  });

  it('writeAnsiString respects maxWidth limit', () => {
    const screen = createScreenBuffer(20, 5);
    const written = screen.writeAnsiString(0, 0, 3, 'hello world');
    expect(written).toBe(3);
  });

  it('writeAnsiString returns 0 for empty string', () => {
    const screen = createScreenBuffer(10, 5);
    expect(screen.writeAnsiString(0, 0, 10, '')).toBe(0);
  });

  it('writeAnsiString respects column boundary in addition to maxWidth', () => {
    const screen = createScreenBuffer(5, 5);
    const written = screen.writeAnsiString(0, 3, 10, 'hello world');
    // cols 3 and 4 available = 2 visible chars max
    expect(written).toBe(2);
  });

  // --- drawBox ---

  it('drawBox places top-left corner character ┌', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('┌');
  });

  it('drawBox places top-right corner character ┐', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('┐');
  });

  it('drawBox places bottom-left corner character └', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('└');
  });

  it('drawBox places bottom-right corner character ┘', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('┘');
  });

  it('drawBox uses horizontal line characters ─', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('─');
  });

  it('drawBox uses vertical line characters │', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('│');
  });

  it('drawBox with title places title in top border', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 14, height: 5 }, '', 'MyTitle');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('MyTitle');
  });

  it('drawBox with focused=true uses double-line corner ╔', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '', undefined, undefined, true);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('╔');
  });

  it('drawBox with focused=true uses double-line corner ╗', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '', undefined, undefined, true);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('╗');
  });

  it('drawBox with focused=true uses double-line corners ╚ and ╝', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '', undefined, undefined, true);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('╚');
    expect(out).toContain('╝');
  });

  it('drawBox with focused=true uses double-line horizontal ═ and vertical ║', () => {
    const screen = createScreenBuffer(20, 10);
    screen.drawBox({ left: 0, top: 0, width: 10, height: 5 }, '', undefined, undefined, true);
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    const out = getOutput();
    expect(out).toContain('═');
    expect(out).toContain('║');
  });

  // --- clear ---

  it('clear resets all cells to space with no style', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'X', '\x1b[31m', '\x1b[44m', ATTR_BOLD);
    screen.clear();
    // After clear, first flush should emit nothing meaningful (all spaces)
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    // After clear, the cell was set back to space — no 'X' should appear
    expect(getOutput()).not.toContain('X');
  });

  it('clear followed by new content flushes new content', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'A');
    const { stream: s1 } = makeMockStream();
    screen.flush(s1); // commits A to prev

    screen.clear();
    screen.put(0, 0, 'B');
    const { stream: s2, getOutput: getOut2 } = makeMockStream();
    screen.flush(s2);
    expect(getOut2()).toContain('B');
  });

  // --- flush diff behavior ---

  it('first flush emits all non-space cells', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'Z');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('Z');
  });

  it('second flush with no changes emits nothing (minimal output)', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'A');
    const { stream: s1 } = makeMockStream();
    screen.flush(s1); // first flush — commits

    // No changes made
    const { stream: s2, getOutput: getOut2 } = makeMockStream();
    screen.flush(s2);
    // Should not write to stream when nothing changed (only HIDE_CURSOR check)
    expect(getOut2()).toBe('');
  });

  it('flush only emits changed cells on second flush', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'A');
    screen.put(0, 1, 'B');
    const { stream: s1 } = makeMockStream();
    screen.flush(s1);

    // Change only cell (0,0)
    screen.put(0, 0, 'C');
    const { stream: s2, getOutput: getOut2 } = makeMockStream();
    screen.flush(s2);
    const out = getOut2();
    expect(out).toContain('C');
    // B was not changed so no B in diff output — it should not re-emit
    expect(out).not.toContain('B');
  });

  it('flush ends with reset sequence', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'A');
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).toContain('\x1b[0m');
  });

  // --- resize ---

  it('resize updates cols and rows', () => {
    const screen = createScreenBuffer(80, 24);
    screen.resize(120, 40);
    expect(screen.cols).toBe(120);
    expect(screen.rows).toBe(40);
  });

  it('resize forces full redraw on next flush', () => {
    const screen = createScreenBuffer(10, 5);
    screen.put(0, 0, 'X');
    const { stream: s1 } = makeMockStream();
    screen.flush(s1);

    screen.resize(10, 5);
    screen.clear();
    const { stream: s2, getOutput: getOut2 } = makeMockStream();
    screen.flush(s2);
    expect(getOut2().length).toBeGreaterThan(0);
  });

  it('resize allows writing to new larger dimensions', () => {
    const screen = createScreenBuffer(10, 5);
    screen.resize(20, 10);
    expect(() => screen.put(9, 19, 'X')).not.toThrow();
  });

  it('put is no-op after resize for old out-of-bounds coordinates', () => {
    const screen = createScreenBuffer(10, 5);
    screen.resize(5, 3);
    // (0,9) was valid before resize but out-of-bounds after
    expect(() => screen.put(0, 9, 'X')).not.toThrow();
    const { stream, getOutput } = makeMockStream();
    screen.flush(stream);
    expect(getOutput()).not.toContain('X');
  });
});
