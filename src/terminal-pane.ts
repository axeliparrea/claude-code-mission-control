/**
 * Terminal pane with full VT100 emulation via @xterm/headless.
 * Used for the primary Claude Code output stream.
 * @module terminal-pane
 */

import xtermHeadless from '@xterm/headless';
import type { Terminal as TerminalType } from '@xterm/headless';
const { Terminal } = xtermHeadless;
import {
  ATTR_BOLD,
  ATTR_DIM,
  ATTR_ITALIC,
  ATTR_UNDERLINE,
  ATTR_INVERSE,
} from './types.js';
import type { PaneBase, Rect, ScreenBuffer } from './types.js';

function paletteFg(colorIndex: number): string {
  if (colorIndex < 8) return `\x1b[${30 + colorIndex}m`;
  if (colorIndex < 16) return `\x1b[${90 + (colorIndex - 8)}m`;
  return `\x1b[38;5;${colorIndex}m`;
}

function paletteBg(colorIndex: number): string {
  if (colorIndex < 8) return `\x1b[${40 + colorIndex}m`;
  if (colorIndex < 16) return `\x1b[${100 + (colorIndex - 8)}m`;
  return `\x1b[48;5;${colorIndex}m`;
}

function rgbFg(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return `\x1b[38;2;${r};${g};${b}m`;
}

function rgbBg(packed: number): string {
  const r = (packed >> 16) & 0xff;
  const g = (packed >> 8) & 0xff;
  const b = packed & 0xff;
  return `\x1b[48;2;${r};${g};${b}m`;
}

/**
 * A pane providing full VT100 terminal emulation backed by @xterm/headless.
 * Feeds raw PTY data to xterm and renders the parsed cell buffer to a ScreenBuffer.
 */
export class TerminalPane implements PaneBase {
  readonly id: string;
  title: string;
  rect: Rect;
  borderColor: string;
  focused: boolean;

  private terminal: TerminalType;
  private _userScrolled = false;

  /**
   * Creates a new TerminalPane.
   * @param id - Unique pane identifier
   * @param title - Title displayed in the border
   * @param rect - Rectangular region this pane occupies
   * @param borderColor - ANSI SGR color sequence for the border
   */
  constructor(id: string, title: string, rect: Rect, borderColor: string) {
    this.id = id;
    this.title = title;
    this.rect = rect;
    this.borderColor = borderColor;
    this.focused = false;

    this.terminal = new Terminal({
      cols: Math.max(1, rect.width - 2),
      rows: Math.max(1, rect.height - 2),
      allowProposedApi: true,
    });
  }

  /**
   * Feeds raw PTY output data to the xterm terminal emulator.
   * @param data - Raw byte string from the PTY
   */
  write(data: string): void {
    this.terminal.write(data);
    if (!this._userScrolled) {
      this.terminal.scrollToBottom();
    }
  }

  /**
   * Updates the pane's rect and resizes the xterm terminal accordingly.
   * @param rect - New rectangular region for this pane
   */
  resize(rect: Rect): void {
    this.rect = rect;
    const newCols = Math.max(1, rect.width - 2);
    const newRows = Math.max(1, rect.height - 2);
    this.terminal.resize(newCols, newRows);
  }

  /**
   * Scrolls the terminal viewport up by one line.
   */
  scrollUp(): void {
    this._userScrolled = true;
    this.terminal.scrollLines(-1);
  }

  /**
   * Scrolls the terminal viewport down by one line.
   */
  scrollDown(): void {
    this.terminal.scrollLines(1);
    const buf = this.terminal.buffer.active;
    const maxViewport = buf.length - this.terminal.rows;
    if (buf.viewportY >= maxViewport) {
      this._userScrolled = false;
    }
  }

  /**
   * Renders the terminal content into the provided screen buffer.
   * Draws the pane border, then reads each cell from xterm's active buffer
   * and writes it to the screen buffer with converted color and attribute data.
   * @param screen - The screen buffer to render into
   */
  renderTo(screen: ScreenBuffer): void {
    screen.drawBox(this.rect, this.borderColor, this.title, undefined, this.focused);

    const buffer = this.terminal.buffer.active;
    const termCols = Math.max(1, this.rect.width - 2);
    const termRows = Math.max(1, this.rect.height - 2);
    const originRow = this.rect.top + 1;
    const originCol = this.rect.left + 1;
    const viewportBase = buffer.viewportY;

    for (let y = 0; y < termRows; y++) {
      const line = buffer.getLine(viewportBase + y);
      if (line === undefined) continue;

      for (let x = 0; x < termCols; x++) {
        const cell = line.getCell(x);
        if (cell === undefined) continue;

        const chars = cell.getChars();
        const char = chars.length > 0 ? chars : ' ';

        const fg = resolveFg(cell);
        const bg = resolveBg(cell);
        const attrs = resolveAttrs(cell);

        screen.put(originRow + y, originCol + x, char, fg, bg, attrs);
      }
    }
  }
}

import type { IBufferCell } from '@xterm/headless';

function resolveFg(cell: IBufferCell): string {
  if (cell.isFgDefault()) return '';
  if (cell.isFgRGB()) return rgbFg(cell.getFgColor());
  if (cell.isFgPalette()) return paletteFg(cell.getFgColor());
  return '';
}

function resolveBg(cell: IBufferCell): string {
  if (cell.isBgDefault()) return '';
  if (cell.isBgRGB()) return rgbBg(cell.getBgColor());
  if (cell.isBgPalette()) return paletteBg(cell.getBgColor());
  return '';
}

function resolveAttrs(cell: IBufferCell): number {
  let attrs = 0;
  if (cell.isBold()) attrs |= ATTR_BOLD;
  if (cell.isDim()) attrs |= ATTR_DIM;
  if (cell.isItalic()) attrs |= ATTR_ITALIC;
  if (cell.isUnderline()) attrs |= ATTR_UNDERLINE;
  if (cell.isInverse()) attrs |= ATTR_INVERSE;
  return attrs;
}

/**
 * Creates a new TerminalPane with the specified configuration.
 * @param id - Unique pane identifier
 * @param title - Title displayed in the border
 * @param rect - Rectangular region this pane occupies
 * @param borderColor - ANSI SGR color sequence for the border
 * @returns A configured TerminalPane instance
 */
export function createTerminalPane(
  id: string,
  title: string,
  rect: Rect,
  borderColor: string
): TerminalPane {
  return new TerminalPane(id, title, rect, borderColor);
}
