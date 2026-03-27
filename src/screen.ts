/**
 * Screen buffer with diff-based ANSI rendering to a terminal stream.
 * Manages a 2D grid of cells and emits only changed cells on flush.
 * @module screen
 */

import { parseAnsiToCells } from './ansi.js';
import type { Cell, Rect, ScreenBuffer } from './types.js';

/** ANSI reset sequence. */
const RESET = '\x1b[0m';

/** Hide cursor sequence. */
const HIDE_CURSOR = '\x1b[?25l';

/** Box-drawing characters for standard borders. */
const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  focusTopLeft: '╔',
  focusTopRight: '╗',
  focusBottomLeft: '╚',
  focusBottomRight: '╝',
  focusHorizontal: '═',
  focusVertical: '║',
} as const;

function makeEmptyCell(): Cell {
  return { char: ' ', fg: '', bg: '', attrs: 0 };
}

function makeCellGrid(cols: number, rows: number): Cell[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, makeEmptyCell)
  );
}

function cellsEqual(a: Cell, b: Cell): boolean {
  return a.char === b.char && a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs;
}

function buildAttrSequence(attrs: number): string {
  if (attrs === 0) return '';
  const parts: string[] = [];
  if (attrs & 1) parts.push('1');
  if (attrs & 2) parts.push('2');
  if (attrs & 4) parts.push('3');
  if (attrs & 8) parts.push('4');
  if (attrs & 16) parts.push('7');
  return `\x1b[${parts.join(';')}m`;
}

function moveCursor(row: number, col: number): string {
  return `\x1b[${row + 1};${col + 1}H`;
}

/**
 * Implementation of the ScreenBuffer interface.
 * Maintains current and previous cell grids for diff-based rendering.
 */
export class ScreenBufferImpl implements ScreenBuffer {
  cols: number;
  rows: number;

  private cells: Cell[][];
  private prev: Cell[][];

  /**
   * Creates a new screen buffer with the given dimensions.
   * @param cols - Number of terminal columns
   * @param rows - Number of terminal rows
   */
  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = makeCellGrid(cols, rows);
    this.prev = makeCellGrid(cols, rows);
  }

  /**
   * Fills all cells with spaces and resets all style attributes.
   */
  clear(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const row = this.cells[r];
        if (row !== undefined) {
          row[c] = makeEmptyCell();
        }
      }
    }
  }

  /**
   * Sets a single cell at the specified position.
   * @param row - Row index (0-based, bounds-checked)
   * @param col - Column index (0-based, bounds-checked)
   * @param char - Character to place in the cell
   * @param fg - Optional ANSI SGR foreground sequence
   * @param bg - Optional ANSI SGR background sequence
   * @param attrs - Optional attribute bitmask
   */
  put(row: number, col: number, char: string, fg = '', bg = '', attrs = 0): void {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
    const r = this.cells[row];
    if (r === undefined) return;
    r[col] = { char, fg, bg, attrs };
  }

  /**
   * Writes a plain string into the buffer starting at the given position.
   * @param row - Row index (0-based)
   * @param col - Starting column index (0-based)
   * @param text - Plain text to write
   * @param fg - Optional ANSI SGR foreground sequence
   * @param bg - Optional ANSI SGR background sequence
   * @param attrs - Optional attribute bitmask
   * @returns Number of characters written
   */
  writeString(row: number, col: number, text: string, fg = '', bg = '', attrs = 0): number {
    let written = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === undefined) break;
      if (col + i >= this.cols) break;
      this.put(row, col + i, ch, fg, bg, attrs);
      written++;
    }
    return written;
  }

  /**
   * Parses an ANSI-encoded string and writes styled cells up to maxWidth visible characters.
   * @param row - Row index (0-based)
   * @param col - Starting column index (0-based)
   * @param maxWidth - Maximum visible characters to write
   * @param text - ANSI-encoded text to parse and render
   * @returns Number of visible characters written
   */
  writeAnsiString(row: number, col: number, maxWidth: number, text: string): number {
    const cells = parseAnsiToCells(text);
    let written = 0;
    for (let i = 0; i < cells.length && written < maxWidth; i++) {
      const cell = cells[i];
      if (cell === undefined) break;
      if (col + written >= this.cols) break;
      this.put(row, col + written, cell.char, cell.fg, cell.bg, cell.attrs);
      written++;
    }
    return written;
  }

  /**
   * Draws a box border using Unicode box-drawing characters.
   * When focused, uses double-line box characters for emphasis.
   * @param rect - The rectangle defining the outer box boundary
   * @param borderColor - ANSI SGR color sequence for the border characters
   * @param title - Optional title string rendered in the top border
   * @param titleColor - Optional ANSI SGR color for the title text
   * @param focused - Whether to render focused (double-line) borders
   */
  drawBox(rect: Rect, borderColor: string, title?: string, titleColor?: string, focused = false): void {
    const { left, top, width, height } = rect;
    const right = left + width - 1;
    const bottom = top + height - 1;

    const tl = focused ? BOX.focusTopLeft : BOX.topLeft;
    const tr = focused ? BOX.focusTopRight : BOX.topRight;
    const bl = focused ? BOX.focusBottomLeft : BOX.bottomLeft;
    const br = focused ? BOX.focusBottomRight : BOX.bottomRight;
    const hz = focused ? BOX.focusHorizontal : BOX.horizontal;
    const vt = focused ? BOX.focusVertical : BOX.vertical;

    this.put(top, left, tl, borderColor);
    this.put(top, right, tr, borderColor);
    this.put(bottom, left, bl, borderColor);
    this.put(bottom, right, br, borderColor);

    for (let c = left + 1; c < right; c++) {
      this.put(top, c, hz, borderColor);
      this.put(bottom, c, hz, borderColor);
    }

    for (let r = top + 1; r < bottom; r++) {
      this.put(r, left, vt, borderColor);
      this.put(r, right, vt, borderColor);
    }

    if (title !== undefined && title.length > 0 && width > 4) {
      const maxTitleLen = width - 4;
      const displayTitle = title.length > maxTitleLen ? title.slice(0, maxTitleLen) : title;
      const titleStart = left + 2;
      const color = titleColor ?? borderColor;
      this.writeString(top, titleStart, displayTitle, color);
    }
  }

  /**
   * Emits only changed cells to the output stream using diff-based rendering.
   * Optimizes output by tracking cursor position and last-emitted style to
   * avoid redundant escape sequences. Swaps current and previous grids after flush.
   * @param stream - The writable stream to emit ANSI escape sequences to
   */
  flush(stream: NodeJS.WriteStream): void {
    let output = HIDE_CURSOR;
    let lastFg = '';
    let lastBg = '';
    let lastAttrs = -1;
    let lastRow = -1;
    let lastCol = -1;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cur = this.cells[r]?.[c];
        const prv = this.prev[r]?.[c];
        if (cur === undefined || prv === undefined) continue;
        if (cellsEqual(cur, prv)) continue;

        const needsMove = lastRow !== r || lastCol !== c;
        if (needsMove) {
          output += moveCursor(r, c);
        }

        const styleChanged = cur.fg !== lastFg || cur.bg !== lastBg || cur.attrs !== lastAttrs;
        if (styleChanged) {
          output += RESET;
          if (cur.fg) output += cur.fg;
          if (cur.bg) output += cur.bg;
          if (cur.attrs) output += buildAttrSequence(cur.attrs);
          lastFg = cur.fg;
          lastBg = cur.bg;
          lastAttrs = cur.attrs;
        }

        output += cur.char;
        lastRow = r;
        lastCol = c + 1;
      }
    }

    if (output !== HIDE_CURSOR) {
      output += RESET;
      stream.write(output);
    }

    const tmp = this.prev;
    this.prev = this.cells;
    this.cells = tmp;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const src = this.prev[r]?.[c];
        const dst = this.cells[r];
        if (src !== undefined && dst !== undefined) {
          dst[c] = { ...src };
        }
      }
    }
  }

  /**
   * Resizes the buffer to new dimensions, recreating both cell grids.
   * @param cols - New column count
   * @param rows - New row count
   */
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.cells = makeCellGrid(cols, rows);
    this.prev = makeCellGrid(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.prev[r]![c]!.char = '\x00';
      }
    }
  }
}

/**
 * Creates a new screen buffer with the specified dimensions.
 * @param cols - Number of terminal columns
 * @param rows - Number of terminal rows
 * @returns A new ScreenBuffer instance
 */
export function createScreenBuffer(cols: number, rows: number): ScreenBuffer {
  return new ScreenBufferImpl(cols, rows);
}
