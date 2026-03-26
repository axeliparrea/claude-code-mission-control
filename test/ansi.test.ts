import { describe, it, expect } from 'vitest';
import { parseAnsiToCells, stripAnsi } from '../src/ansi.js';
import { ATTR_BOLD, ATTR_DIM, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_INVERSE } from '../src/types.js';

describe('stripAnsi', () => {
  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('removes a simple SGR sequence', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('removes bold sequence', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[0m')).toBe('bold');
  });

  it('removes 256-color sequence', () => {
    expect(stripAnsi('\x1b[38;5;196mtext\x1b[0m')).toBe('text');
  });

  it('removes RGB true-color sequence', () => {
    expect(stripAnsi('\x1b[38;2;255;0;128mtext\x1b[0m')).toBe('text');
  });

  it('returns empty string for empty input', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('returns empty string when input is only escape sequences', () => {
    expect(stripAnsi('\x1b[1m\x1b[31m\x1b[0m')).toBe('');
  });

  it('preserves unicode characters', () => {
    expect(stripAnsi('\x1b[32m⚡ thinking\x1b[0m')).toBe('⚡ thinking');
  });

  it('strips multiple mixed sequences', () => {
    expect(stripAnsi('\x1b[1m\x1b[31mhello\x1b[0m world \x1b[33mfoo\x1b[0m')).toBe('hello world foo');
  });

  it('handles text with no escape sequences', () => {
    const text = 'no escapes here 123';
    expect(stripAnsi(text)).toBe(text);
  });
});

describe('parseAnsiToCells', () => {
  it('returns empty array for empty string', () => {
    expect(parseAnsiToCells('')).toEqual([]);
  });

  it('produces cells for plain text with empty styles', () => {
    const cells = parseAnsiToCells('abc');
    expect(cells).toHaveLength(3);
    expect(cells[0]).toEqual({ char: 'a', fg: '', bg: '', attrs: 0 });
    expect(cells[1]).toEqual({ char: 'b', fg: '', bg: '', attrs: 0 });
    expect(cells[2]).toEqual({ char: 'c', fg: '', bg: '', attrs: 0 });
  });

  it('returns empty array for string containing only ANSI sequences', () => {
    const cells = parseAnsiToCells('\x1b[1m\x1b[31m\x1b[0m');
    expect(cells).toHaveLength(0);
  });

  it('applies ATTR_BOLD for \\x1b[1m', () => {
    const cells = parseAnsiToCells('\x1b[1mX');
    expect(cells).toHaveLength(1);
    expect(cells[0]?.attrs).toBe(ATTR_BOLD);
    expect(cells[0]?.char).toBe('X');
  });

  it('applies ATTR_DIM for \\x1b[2m', () => {
    const cells = parseAnsiToCells('\x1b[2mX');
    expect(cells[0]?.attrs).toBe(ATTR_DIM);
  });

  it('applies ATTR_ITALIC for \\x1b[3m', () => {
    const cells = parseAnsiToCells('\x1b[3mX');
    expect(cells[0]?.attrs).toBe(ATTR_ITALIC);
  });

  it('applies ATTR_UNDERLINE for \\x1b[4m', () => {
    const cells = parseAnsiToCells('\x1b[4mX');
    expect(cells[0]?.attrs).toBe(ATTR_UNDERLINE);
  });

  it('applies ATTR_INVERSE for \\x1b[7m', () => {
    const cells = parseAnsiToCells('\x1b[7mX');
    expect(cells[0]?.attrs).toBe(ATTR_INVERSE);
  });

  it('sets fg to standard ANSI red for \\x1b[31m', () => {
    const cells = parseAnsiToCells('\x1b[31mR');
    expect(cells[0]?.fg).toBe('\x1b[31m');
    expect(cells[0]?.bg).toBe('');
  });

  it('sets fg to standard ANSI green for \\x1b[32m', () => {
    const cells = parseAnsiToCells('\x1b[32mG');
    expect(cells[0]?.fg).toBe('\x1b[32m');
  });

  it('sets bg to standard ANSI blue for \\x1b[44m', () => {
    const cells = parseAnsiToCells('\x1b[44mB');
    expect(cells[0]?.bg).toBe('\x1b[44m');
    expect(cells[0]?.fg).toBe('');
  });

  it('sets fg for 256-color \\x1b[38;5;196m', () => {
    const cells = parseAnsiToCells('\x1b[38;5;196mX');
    expect(cells[0]?.fg).toBe('\x1b[38;5;196m');
  });

  it('sets bg for 256-color \\x1b[48;5;22m', () => {
    const cells = parseAnsiToCells('\x1b[48;5;22mX');
    expect(cells[0]?.bg).toBe('\x1b[48;5;22m');
  });

  it('sets fg for RGB true-color \\x1b[38;2;255;0;128m', () => {
    const cells = parseAnsiToCells('\x1b[38;2;255;0;128mX');
    expect(cells[0]?.fg).toBe('\x1b[38;2;255;0;128m');
  });

  it('sets bg for RGB true-color \\x1b[48;2;10;20;30m', () => {
    const cells = parseAnsiToCells('\x1b[48;2;10;20;30mX');
    expect(cells[0]?.bg).toBe('\x1b[48;2;10;20;30m');
  });

  it('applies mixed styles: bold + red fg + blue bg via \\x1b[1;31;44m', () => {
    const cells = parseAnsiToCells('\x1b[1;31;44mX');
    expect(cells[0]?.attrs).toBe(ATTR_BOLD);
    expect(cells[0]?.fg).toBe('\x1b[31m');
    expect(cells[0]?.bg).toBe('\x1b[44m');
  });

  it('reset \\x1b[0m clears fg, bg and attrs', () => {
    const cells = parseAnsiToCells('\x1b[1;31;44mA\x1b[0mB');
    expect(cells[0]?.attrs).toBe(ATTR_BOLD);
    expect(cells[0]?.fg).toBe('\x1b[31m');
    expect(cells[1]?.attrs).toBe(0);
    expect(cells[1]?.fg).toBe('');
    expect(cells[1]?.bg).toBe('');
  });

  it('bare reset \\x1b[m (no params) clears all styles', () => {
    const cells = parseAnsiToCells('\x1b[1mA\x1b[mB');
    expect(cells[0]?.attrs).toBe(ATTR_BOLD);
    expect(cells[1]?.attrs).toBe(0);
  });

  it('style carries across characters until reset', () => {
    const cells = parseAnsiToCells('\x1b[31mABC\x1b[0mD');
    expect(cells[0]?.fg).toBe('\x1b[31m');
    expect(cells[1]?.fg).toBe('\x1b[31m');
    expect(cells[2]?.fg).toBe('\x1b[31m');
    expect(cells[3]?.fg).toBe('');
  });

  it('bright fg colors (\\x1b[90m-\\x1b[97m) are supported', () => {
    const cells = parseAnsiToCells('\x1b[92mX');
    expect(cells[0]?.fg).toBe('\x1b[92m');
  });

  it('bright bg colors (\\x1b[100m-\\x1b[107m) are supported', () => {
    const cells = parseAnsiToCells('\x1b[102mX');
    expect(cells[0]?.bg).toBe('\x1b[102m');
  });

  it('fg default reset code 39 clears fg only', () => {
    const cells = parseAnsiToCells('\x1b[31;44mA\x1b[39mB');
    expect(cells[0]?.fg).toBe('\x1b[31m');
    expect(cells[1]?.fg).toBe('');
    expect(cells[1]?.bg).toBe('\x1b[44m');
  });

  it('bg default reset code 49 clears bg only', () => {
    const cells = parseAnsiToCells('\x1b[31;44mA\x1b[49mB');
    expect(cells[0]?.bg).toBe('\x1b[44m');
    expect(cells[1]?.bg).toBe('');
    expect(cells[1]?.fg).toBe('\x1b[31m');
  });

  it('preserves unicode characters in output', () => {
    const cells = parseAnsiToCells('⚡ abc');
    expect(cells[0]?.char).toBe('⚡');
    expect(cells[2]?.char).toBe('a');
  });

  it('control characters below space are not included in cells', () => {
    const cells = parseAnsiToCells('a\x01\x08b');
    // only 'a' and 'b' should appear
    const chars = cells.map(c => c.char);
    expect(chars).not.toContain('\x01');
    expect(chars).not.toContain('\x08');
    expect(chars).toContain('a');
    expect(chars).toContain('b');
  });

  it('removes bold and dim via code 22', () => {
    const cells = parseAnsiToCells('\x1b[1mA\x1b[22mB');
    expect(cells[0]?.attrs & ATTR_BOLD).toBe(ATTR_BOLD);
    expect(cells[1]?.attrs & ATTR_BOLD).toBe(0);
  });

  it('removes italic via code 23', () => {
    const cells = parseAnsiToCells('\x1b[3mA\x1b[23mB');
    expect(cells[0]?.attrs & ATTR_ITALIC).toBe(ATTR_ITALIC);
    expect(cells[1]?.attrs & ATTR_ITALIC).toBe(0);
  });

  it('removes underline via code 24', () => {
    const cells = parseAnsiToCells('\x1b[4mA\x1b[24mB');
    expect(cells[0]?.attrs & ATTR_UNDERLINE).toBe(ATTR_UNDERLINE);
    expect(cells[1]?.attrs & ATTR_UNDERLINE).toBe(0);
  });

  it('handles long strings efficiently', () => {
    const long = 'x'.repeat(10000);
    const cells = parseAnsiToCells(long);
    expect(cells).toHaveLength(10000);
    expect(cells[0]?.fg).toBe('');
  });
});
