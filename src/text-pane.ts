/**
 * Scrollable text pane with a ring buffer for ANSI-encoded output.
 * Used for THINKING, MCP, FILES, and AGENT panels.
 * @module text-pane
 */

import type { PaneBase, Rect, ScreenBuffer } from './types.js';

const DEFAULT_MAX_LINES = 500;

/**
 * A scrollable pane that displays ANSI-encoded text lines with a bounded ring buffer.
 */
export class TextPane implements PaneBase {
  readonly id: string;
  title: string;
  rect: Rect;
  borderColor: string;
  focused: boolean;

  private readonly maxLines: number;
  private _lines: string[];
  private _scrollOffset: number;

  /**
   * Creates a new TextPane.
   * @param id - Unique pane identifier
   * @param title - Title displayed in the pane border
   * @param rect - Rectangular region this pane occupies
   * @param borderColor - ANSI SGR color sequence for the border
   * @param maxLines - Maximum number of lines to retain in the ring buffer
   */
  constructor(
    id: string,
    title: string,
    rect: Rect,
    borderColor: string,
    maxLines = DEFAULT_MAX_LINES
  ) {
    this.id = id;
    this.title = title;
    this.rect = rect;
    this.borderColor = borderColor;
    this.focused = false;
    this.maxLines = maxLines;
    this._lines = [];
    this._scrollOffset = 0;
  }

  /** Current buffered lines (may contain ANSI escape codes). */
  get lines(): string[] {
    return this._lines;
  }

  /** Current scroll offset (number of lines from the top of the buffer). */
  get scrollOffset(): number {
    return this._scrollOffset;
  }

  private get contentHeight(): number {
    return Math.max(0, this.rect.height - 2);
  }

  private isAtBottom(): boolean {
    return this._scrollOffset >= Math.max(0, this._lines.length - this.contentHeight);
  }

  /**
   * Appends a line to the buffer, trimming to maxLines (ring buffer).
   * If the viewport was already at the bottom, auto-scrolls to follow new content.
   * @param text - The line of text to append (may contain ANSI escape codes)
   */
  appendLine(text: string): void {
    const wasAtBottom = this.isAtBottom();

    this._lines = [...this._lines, text];

    if (this._lines.length > this.maxLines) {
      this._lines = this._lines.slice(this._lines.length - this.maxLines);
    }

    if (wasAtBottom) {
      this._scrollOffset = Math.max(0, this._lines.length - this.contentHeight);
    }
  }

  /**
   * Clears all buffered lines and resets scroll position.
   */
  clear(): void {
    this._lines = [];
    this._scrollOffset = 0;
  }

  /**
   * Scrolls the viewport up by one line (towards older content).
   */
  scrollUp(): void {
    this._scrollOffset = Math.max(0, this._scrollOffset - 1);
  }

  /**
   * Scrolls the viewport down by one line (towards newer content).
   */
  scrollDown(): void {
    const maxOffset = Math.max(0, this._lines.length - this.contentHeight);
    this._scrollOffset = Math.min(maxOffset, this._scrollOffset + 1);
  }

  /**
   * Updates the pane title.
   * @param title - The new title to display in the border
   */
  setTitle(title: string): void {
    this.title = title;
  }

  /**
   * Renders the pane border and visible lines into the screen buffer.
   * Each visible line is rendered with ANSI color support via writeAnsiString.
   * @param screen - The screen buffer to render into
   */
  renderTo(screen: ScreenBuffer): void {
    screen.drawBox(this.rect, this.borderColor, this.title, undefined, this.focused);

    const height = this.contentHeight;
    const width = Math.max(0, this.rect.width - 4);
    const originRow = this.rect.top + 1;
    const originCol = this.rect.left + 2;

    for (let i = 0; i < height; i++) {
      const lineIndex = this._scrollOffset + i;
      const line = this._lines[lineIndex];

      if (line !== undefined) {
        screen.writeAnsiString(originRow + i, originCol, width, line);
      }
    }
  }
}

/**
 * Creates a new TextPane with the specified configuration.
 * @param id - Unique pane identifier
 * @param title - Title displayed in the pane border
 * @param rect - Rectangular region this pane occupies
 * @param borderColor - ANSI SGR color sequence for the border
 * @param maxLines - Optional maximum number of lines to retain (default: 500)
 * @returns A configured TextPane instance
 */
export function createTextPane(
  id: string,
  title: string,
  rect: Rect,
  borderColor: string,
  maxLines?: number
): TextPane {
  return new TextPane(id, title, rect, borderColor, maxLines);
}
