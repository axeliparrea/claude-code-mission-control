#!/usr/bin/env node

// src/index.ts
import * as path5 from "path";
import * as fs4 from "fs";
import * as crypto2 from "crypto";

// src/types.ts
var ATTR_BOLD = 1;
var ATTR_DIM = 2;
var ATTR_ITALIC = 4;
var ATTR_UNDERLINE = 8;
var ATTR_INVERSE = 16;

// src/ansi.ts
var STANDARD_FG = [
  "\x1B[30m",
  "\x1B[31m",
  "\x1B[32m",
  "\x1B[33m",
  "\x1B[34m",
  "\x1B[35m",
  "\x1B[36m",
  "\x1B[37m"
];
var BRIGHT_FG = [
  "\x1B[90m",
  "\x1B[91m",
  "\x1B[92m",
  "\x1B[93m",
  "\x1B[94m",
  "\x1B[95m",
  "\x1B[96m",
  "\x1B[97m"
];
var STANDARD_BG = [
  "\x1B[40m",
  "\x1B[41m",
  "\x1B[42m",
  "\x1B[43m",
  "\x1B[44m",
  "\x1B[45m",
  "\x1B[46m",
  "\x1B[47m"
];
var BRIGHT_BG = [
  "\x1B[100m",
  "\x1B[101m",
  "\x1B[102m",
  "\x1B[103m",
  "\x1B[104m",
  "\x1B[105m",
  "\x1B[106m",
  "\x1B[107m"
];
function applyCode(codes, idx, state) {
  const code = codes[idx] ?? 0;
  if (code === 0) {
    state.fg = "";
    state.bg = "";
    state.attrs = 0;
    return idx + 1;
  }
  if (code === 1) {
    state.attrs |= ATTR_BOLD;
    return idx + 1;
  }
  if (code === 2) {
    state.attrs |= ATTR_DIM;
    return idx + 1;
  }
  if (code === 3) {
    state.attrs |= ATTR_ITALIC;
    return idx + 1;
  }
  if (code === 4) {
    state.attrs |= ATTR_UNDERLINE;
    return idx + 1;
  }
  if (code === 7) {
    state.attrs |= ATTR_INVERSE;
    return idx + 1;
  }
  if (code === 22) {
    state.attrs &= ~(ATTR_BOLD | ATTR_DIM);
    return idx + 1;
  }
  if (code === 23) {
    state.attrs &= ~ATTR_ITALIC;
    return idx + 1;
  }
  if (code === 24) {
    state.attrs &= ~ATTR_UNDERLINE;
    return idx + 1;
  }
  if (code === 27) {
    state.attrs &= ~ATTR_INVERSE;
    return idx + 1;
  }
  if (code === 39) {
    state.fg = "";
    return idx + 1;
  }
  if (code === 49) {
    state.bg = "";
    return idx + 1;
  }
  if (code >= 30 && code <= 37) {
    state.fg = STANDARD_FG[code - 30] ?? "";
    return idx + 1;
  }
  if (code >= 40 && code <= 47) {
    state.bg = STANDARD_BG[code - 40] ?? "";
    return idx + 1;
  }
  if (code >= 90 && code <= 97) {
    state.fg = BRIGHT_FG[code - 90] ?? "";
    return idx + 1;
  }
  if (code >= 100 && code <= 107) {
    state.bg = BRIGHT_BG[code - 100] ?? "";
    return idx + 1;
  }
  if (code === 38) {
    const mode = codes[idx + 1];
    if (mode === 5) {
      const n = codes[idx + 2] ?? 0;
      state.fg = `\x1B[38;5;${n}m`;
      return idx + 3;
    }
    if (mode === 2) {
      const r = codes[idx + 2] ?? 0;
      const g = codes[idx + 3] ?? 0;
      const b = codes[idx + 4] ?? 0;
      state.fg = `\x1B[38;2;${r};${g};${b}m`;
      return idx + 5;
    }
  }
  if (code === 48) {
    const mode = codes[idx + 1];
    if (mode === 5) {
      const n = codes[idx + 2] ?? 0;
      state.bg = `\x1B[48;5;${n}m`;
      return idx + 3;
    }
    if (mode === 2) {
      const r = codes[idx + 2] ?? 0;
      const g = codes[idx + 3] ?? 0;
      const b = codes[idx + 4] ?? 0;
      state.bg = `\x1B[48;2;${r};${g};${b}m`;
      return idx + 5;
    }
  }
  return idx + 1;
}
function parseSgrSequence(seq, state) {
  const inner = seq.slice(2, -1);
  if (inner === "") {
    state.fg = "";
    state.bg = "";
    state.attrs = 0;
    return;
  }
  const codes = inner.split(";").map(Number);
  let i = 0;
  while (i < codes.length) {
    i = applyCode(codes, i, state);
  }
}
function parseAnsiToCells(text) {
  const cells = [];
  const state = { fg: "", bg: "", attrs: 0 };
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\x1B" && text[i + 1] === "[") {
      const end = text.indexOf("m", i + 2);
      if (end !== -1) {
        const seq = text.slice(i, end + 1);
        parseSgrSequence(seq, state);
        i = end + 1;
        continue;
      }
    }
    const ch = text[i];
    if (ch !== void 0 && ch >= " ") {
      cells.push({ char: ch, fg: state.fg, bg: state.bg, attrs: state.attrs });
    }
    i++;
  }
  return cells;
}

// src/screen.ts
var RESET = "\x1B[0m";
var HIDE_CURSOR = "\x1B[?25l";
var BOX = {
  topLeft: "\u250C",
  topRight: "\u2510",
  bottomLeft: "\u2514",
  bottomRight: "\u2518",
  horizontal: "\u2500",
  vertical: "\u2502",
  focusTopLeft: "\u2554",
  focusTopRight: "\u2557",
  focusBottomLeft: "\u255A",
  focusBottomRight: "\u255D",
  focusHorizontal: "\u2550",
  focusVertical: "\u2551"
};
function makeEmptyCell() {
  return { char: " ", fg: "", bg: "", attrs: 0 };
}
function makeCellGrid(cols, rows) {
  return Array.from(
    { length: rows },
    () => Array.from({ length: cols }, makeEmptyCell)
  );
}
function cellsEqual(a, b) {
  return a.char === b.char && a.fg === b.fg && a.bg === b.bg && a.attrs === b.attrs;
}
function buildAttrSequence(attrs) {
  if (attrs === 0) return "";
  const parts = [];
  if (attrs & 1) parts.push("1");
  if (attrs & 2) parts.push("2");
  if (attrs & 4) parts.push("3");
  if (attrs & 8) parts.push("4");
  if (attrs & 16) parts.push("7");
  return `\x1B[${parts.join(";")}m`;
}
function moveCursor(row, col) {
  return `\x1B[${row + 1};${col + 1}H`;
}
var ScreenBufferImpl = class {
  cols;
  rows;
  cells;
  prev;
  /**
   * Creates a new screen buffer with the given dimensions.
   * @param cols - Number of terminal columns
   * @param rows - Number of terminal rows
   */
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = makeCellGrid(cols, rows);
    this.prev = makeCellGrid(cols, rows);
  }
  /**
   * Fills all cells with spaces and resets all style attributes.
   */
  clear() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const row = this.cells[r];
        if (row !== void 0) {
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
  put(row, col, char, fg2 = "", bg2 = "", attrs = 0) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
    const r = this.cells[row];
    if (r === void 0) return;
    r[col] = { char, fg: fg2, bg: bg2, attrs };
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
  writeString(row, col, text, fg2 = "", bg2 = "", attrs = 0) {
    let written = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === void 0) break;
      if (col + i >= this.cols) break;
      this.put(row, col + i, ch, fg2, bg2, attrs);
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
  writeAnsiString(row, col, maxWidth, text) {
    const cells = parseAnsiToCells(text);
    let written = 0;
    for (let i = 0; i < cells.length && written < maxWidth; i++) {
      const cell = cells[i];
      if (cell === void 0) break;
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
  drawBox(rect, borderColor, title, titleColor, focused = false) {
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
    if (title !== void 0 && title.length > 0 && width > 4) {
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
  flush(stream) {
    let output = HIDE_CURSOR;
    let lastFg = "";
    let lastBg = "";
    let lastAttrs = -1;
    let lastRow = -1;
    let lastCol = -1;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cur = this.cells[r]?.[c];
        const prv = this.prev[r]?.[c];
        if (cur === void 0 || prv === void 0) continue;
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
        if (src !== void 0 && dst !== void 0) {
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
  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.cells = makeCellGrid(cols, rows);
    this.prev = makeCellGrid(cols, rows);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.prev[r][c].char = "\0";
      }
    }
  }
};
function createScreenBuffer(cols, rows) {
  return new ScreenBufferImpl(cols, rows);
}

// src/terminal-pane.ts
import xtermHeadless from "@xterm/headless";
var { Terminal } = xtermHeadless;
function paletteFg(colorIndex) {
  if (colorIndex < 8) return `\x1B[${30 + colorIndex}m`;
  if (colorIndex < 16) return `\x1B[${90 + (colorIndex - 8)}m`;
  return `\x1B[38;5;${colorIndex}m`;
}
function paletteBg(colorIndex) {
  if (colorIndex < 8) return `\x1B[${40 + colorIndex}m`;
  if (colorIndex < 16) return `\x1B[${100 + (colorIndex - 8)}m`;
  return `\x1B[48;5;${colorIndex}m`;
}
function rgbFg(packed) {
  const r = packed >> 16 & 255;
  const g = packed >> 8 & 255;
  const b = packed & 255;
  return `\x1B[38;2;${r};${g};${b}m`;
}
function rgbBg(packed) {
  const r = packed >> 16 & 255;
  const g = packed >> 8 & 255;
  const b = packed & 255;
  return `\x1B[48;2;${r};${g};${b}m`;
}
var TerminalPane = class {
  id;
  title;
  rect;
  borderColor;
  focused;
  terminal;
  _userScrolled = false;
  /**
   * Creates a new TerminalPane.
   * @param id - Unique pane identifier
   * @param title - Title displayed in the border
   * @param rect - Rectangular region this pane occupies
   * @param borderColor - ANSI SGR color sequence for the border
   */
  constructor(id, title, rect, borderColor) {
    this.id = id;
    this.title = title;
    this.rect = rect;
    this.borderColor = borderColor;
    this.focused = false;
    this.terminal = new Terminal({
      cols: Math.max(1, rect.width - 2),
      rows: Math.max(1, rect.height - 2),
      allowProposedApi: true
    });
  }
  /**
   * Feeds raw PTY output data to the xterm terminal emulator.
   * @param data - Raw byte string from the PTY
   */
  write(data) {
    this.terminal.write(data);
    if (!this._userScrolled) {
      this.terminal.scrollToBottom();
    }
  }
  /**
   * Updates the pane's rect and resizes the xterm terminal accordingly.
   * @param rect - New rectangular region for this pane
   */
  resize(rect) {
    this.rect = rect;
    const newCols = Math.max(1, rect.width - 2);
    const newRows = Math.max(1, rect.height - 2);
    this.terminal.resize(newCols, newRows);
  }
  /**
   * Scrolls the terminal viewport up by one line.
   */
  scrollUp() {
    this._userScrolled = true;
    this.terminal.scrollLines(-1);
  }
  /**
   * Scrolls the terminal viewport down by one line.
   */
  scrollDown() {
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
  renderTo(screen) {
    screen.drawBox(this.rect, this.borderColor, this.title, void 0, this.focused);
    const buffer = this.terminal.buffer.active;
    const termCols = Math.max(1, this.rect.width - 2);
    const termRows = Math.max(1, this.rect.height - 2);
    const originRow = this.rect.top + 1;
    const originCol = this.rect.left + 1;
    for (let y = 0; y < termRows; y++) {
      const line = buffer.getLine(y);
      if (line === void 0) continue;
      for (let x = 0; x < termCols; x++) {
        const cell = line.getCell(x);
        if (cell === void 0) continue;
        const chars = cell.getChars();
        const char = chars.length > 0 ? chars : " ";
        const fg2 = resolveFg(cell);
        const bg2 = resolveBg(cell);
        const attrs = resolveAttrs(cell);
        screen.put(originRow + y, originCol + x, char, fg2, bg2, attrs);
      }
    }
  }
};
function resolveFg(cell) {
  if (cell.isFgDefault()) return "";
  if (cell.isFgRGB()) return rgbFg(cell.getFgColor());
  if (cell.isFgPalette()) return paletteFg(cell.getFgColor());
  return "";
}
function resolveBg(cell) {
  if (cell.isBgDefault()) return "";
  if (cell.isBgRGB()) return rgbBg(cell.getBgColor());
  if (cell.isBgPalette()) return paletteBg(cell.getBgColor());
  return "";
}
function resolveAttrs(cell) {
  let attrs = 0;
  if (cell.isBold()) attrs |= ATTR_BOLD;
  if (cell.isDim()) attrs |= ATTR_DIM;
  if (cell.isItalic()) attrs |= ATTR_ITALIC;
  if (cell.isUnderline()) attrs |= ATTR_UNDERLINE;
  if (cell.isInverse()) attrs |= ATTR_INVERSE;
  return attrs;
}
function createTerminalPane(id, title, rect, borderColor) {
  return new TerminalPane(id, title, rect, borderColor);
}

// src/text-pane.ts
var DEFAULT_MAX_LINES = 500;
var TextPane = class {
  id;
  title;
  rect;
  borderColor;
  focused;
  maxLines;
  _lines;
  _scrollOffset;
  /**
   * Creates a new TextPane.
   * @param id - Unique pane identifier
   * @param title - Title displayed in the pane border
   * @param rect - Rectangular region this pane occupies
   * @param borderColor - ANSI SGR color sequence for the border
   * @param maxLines - Maximum number of lines to retain in the ring buffer
   */
  constructor(id, title, rect, borderColor, maxLines = DEFAULT_MAX_LINES) {
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
  get lines() {
    return this._lines;
  }
  /** Current scroll offset (number of lines from the top of the buffer). */
  get scrollOffset() {
    return this._scrollOffset;
  }
  get contentHeight() {
    return Math.max(0, this.rect.height - 2);
  }
  isAtBottom() {
    return this._scrollOffset >= Math.max(0, this._lines.length - this.contentHeight);
  }
  /**
   * Appends a line to the buffer, trimming to maxLines (ring buffer).
   * If the viewport was already at the bottom, auto-scrolls to follow new content.
   * @param text - The line of text to append (may contain ANSI escape codes)
   */
  appendLine(text) {
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
  clear() {
    this._lines = [];
    this._scrollOffset = 0;
  }
  /**
   * Scrolls the viewport up by one line (towards older content).
   */
  scrollUp() {
    this._scrollOffset = Math.max(0, this._scrollOffset - 1);
  }
  /**
   * Scrolls the viewport down by one line (towards newer content).
   */
  scrollDown() {
    const maxOffset = Math.max(0, this._lines.length - this.contentHeight);
    this._scrollOffset = Math.min(maxOffset, this._scrollOffset + 1);
  }
  /**
   * Updates the pane title.
   * @param title - The new title to display in the border
   */
  setTitle(title) {
    this.title = title;
  }
  /**
   * Renders the pane border and visible lines into the screen buffer.
   * Each visible line is rendered with ANSI color support via writeAnsiString.
   * @param screen - The screen buffer to render into
   */
  renderTo(screen) {
    screen.drawBox(this.rect, this.borderColor, this.title, void 0, this.focused);
    const height = this.contentHeight;
    const width = Math.max(0, this.rect.width - 4);
    const originRow = this.rect.top + 1;
    const originCol = this.rect.left + 2;
    for (let i = 0; i < height; i++) {
      const lineIndex = this._scrollOffset + i;
      const line = this._lines[lineIndex];
      if (line !== void 0) {
        screen.writeAnsiString(originRow + i, originCol, width, line);
      }
    }
  }
};
function createTextPane(id, title, rect, borderColor, maxLines) {
  return new TextPane(id, title, rect, borderColor, maxLines);
}

// src/pty-manager.ts
import * as nodePty from "node-pty";
function resolveCommand() {
  const cliArgs = process.argv.slice(2);
  const filtered = [];
  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === "--cwd") {
      i++;
      continue;
    }
    filtered.push(cliArgs[i]);
  }
  return { command: "claude", args: filtered };
}
function buildEnv() {
  const termValue = process.platform === "win32" ? "cygwin" : "xterm-256color";
  return {
    ...process.env,
    FORCE_COLOR: "1",
    TERM: termValue
  };
}
function normaliseLineEndings(data) {
  if (process.platform === "win32") {
    return data.replace(/\r\n/g, "\n");
  }
  return data;
}
function createPtyManager() {
  let ptyProcess = null;
  const dataCallbacks = [];
  const exitCallbacks = [];
  function emitData(data) {
    const normalised = normaliseLineEndings(data);
    for (const cb of dataCallbacks) {
      cb(normalised);
    }
  }
  function emitExit(code) {
    for (const cb of exitCallbacks) {
      cb(code);
    }
  }
  return {
    spawn(cols, rows, cwd) {
      const { command, args } = resolveCommand();
      const env = buildEnv();
      const workingDir = cwd ?? process.cwd();
      ptyProcess = nodePty.spawn(command, args, {
        name: "xterm-256color",
        cols,
        rows,
        cwd: workingDir,
        env
      });
      ptyProcess.onData((data) => {
        emitData(data);
      });
      ptyProcess.onExit(({ exitCode }) => {
        emitExit(exitCode);
      });
    },
    write(data) {
      ptyProcess?.write(data);
    },
    resize(cols, rows) {
      ptyProcess?.resize(cols, rows);
    },
    kill() {
      ptyProcess?.kill();
      ptyProcess = null;
    },
    onData(callback) {
      dataCallbacks.push(callback);
    },
    onExit(callback) {
      exitCallbacks.push(callback);
    }
  };
}

// src/parser.ts
var THINKING_LINE_RE = /^\s*[*·•]\s*(thinking|twisting|bootstrapping|cogitat|herding|mustering|pondering|ruminating|deliberat)/i;
var AGENT_SPAWN_RE = /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)|Running agent:|⊞\s*[Ss]pawn|Agent\s+\w+\s+started|Launched? (?:a |new )?(?:agent|sub[_-]?agent)/i;
var AGENT_DONE_RE = /(?:agent|sub[_-]?agent).*(?:done|complete|finished|returned)|Agent completed|✓.*agent/i;
var TOOL_USE_RE = /(?:Tool|Using|Calling):\s*(\S+)|⏳.*(?:Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch)\b|●\s*(?:Searching|Recalling|Reading|Writing|Editing)|(\w+)__(\w+)\s*\(/i;
var MCP_TOOL_RE = /(\w[\w-]*)__(\w[\w-]*)|(\w[\w-]*)\.(\w[\w-]*)\s*(?:\(|:)/;
var TOOL_RESULT_RE = /^Searched for \d+|^Read \d+ |^Wrote \d+ |^Edited \d+ |✓\s*\w+\.\w+|✗\s*\w+/i;
var BASH_CMD_RE = /^\s*[LR]\s+\$\s+/;
var FILE_EDIT_RE = /(?:Modified|Created|Deleted|Wrote|Write to|Editing|Edited):\s*(.+)/i;
var ERROR_RE = /^Error:|✗|FAIL(?:ED)?|panic:|fatal:|hook error$/i;
var UI_CHROME_RE = /^\s*>>|bypasspermission|shift\+tab|Context\s+\d+%|Usage\s+\d+%|resets?\s+in\s+\d+|^\s*\[Sonnet|^\s*\[Opus|^\s*\[Haiku|^\s*\[Claude|ctrl\+o to expand|\(shift\+tab|thinkingwith\w*medium|thinkingwith\w*effort/i;
function extractAgentName(line) {
  const runningMatch = /Running agent:\s*(.+)/i.exec(line);
  if (runningMatch?.[1]) return runningMatch[1].trim();
  const spawnMatch = /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)\s+['""]?(\w[\w\s-]*?)['""]?(?:\s|$)/i.exec(line);
  if (spawnMatch?.[1]) return spawnMatch[1].trim();
  const startedMatch = /Agent\s+(\w+)\s+started/i.exec(line);
  if (startedMatch?.[1]) return startedMatch[1].trim();
  return "Agent";
}
function extractToolName(line) {
  const mcpMatch = MCP_TOOL_RE.exec(line);
  if (mcpMatch) {
    const server = mcpMatch[1] ?? mcpMatch[3] ?? "";
    const tool = mcpMatch[2] ?? mcpMatch[4] ?? "";
    return `${server}:${tool}`;
  }
  const colonMatch = /(?:Tool|Using|Calling):\s*(\S+)/i.exec(line);
  if (colonMatch?.[1]) return colonMatch[1].trim();
  const emojiMatch = /⏳.*?(Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch)\b/.exec(line);
  if (emojiMatch?.[1]) return emojiMatch[1].trim();
  const dotMatch = /●\s*(Searching|Recalling|Reading|Writing|Editing)/i.exec(line);
  if (dotMatch?.[1]) return dotMatch[1].trim();
  if (BASH_CMD_RE.test(line)) return "Bash";
  const resultMatch = /^(Searched|Read|Wrote|Edited)\b/i.exec(line);
  if (resultMatch?.[1]) return resultMatch[1].trim();
  return "tool";
}
function extractServerName(line) {
  const mcpMatch = MCP_TOOL_RE.exec(line);
  if (mcpMatch) {
    return mcpMatch[1] ?? mcpMatch[3];
  }
  return void 0;
}
function extractFilePath(line) {
  const match = /(?:Modified|Created|Deleted|Wrote|Write to|Editing|Edited):\s*(.+)/i.exec(line);
  return match?.[1]?.trim() ?? "";
}
function extractFileOp(line) {
  if (/(?:Deleted)/i.test(line)) return "D";
  if (/(?:Created|Wrote|Write to)/i.test(line)) return "A";
  return "M";
}
function classifyLine(line, state) {
  const clean = line.replace(/\x1b\[[0-9;]*[mGKHFABCDJsu]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[\?[0-9;]*[hl]/g, "").replace(/\x1b[^[\]]/g, "").replace(/\x07/g, "");
  if (UI_CHROME_RE.test(clean)) {
    return { type: "main", text: line, clean };
  }
  if (THINKING_LINE_RE.test(clean)) {
    return { type: "thinking", text: line, clean };
  }
  if (AGENT_SPAWN_RE.test(clean)) {
    state.agentCounter += 1;
    const agentId = `agent-${state.agentCounter}`;
    const agentName = extractAgentName(clean);
    state.currentAgentId = agentId;
    return { type: "agent", text: line, clean, agentId, agentName };
  }
  if (AGENT_DONE_RE.test(clean)) {
    const agentId = state.currentAgentId ?? `agent-${state.agentCounter}`;
    return { type: "agent", text: line, clean, agentId };
  }
  if (TOOL_USE_RE.test(clean) || BASH_CMD_RE.test(clean) || MCP_TOOL_RE.test(clean)) {
    const toolName = extractToolName(clean);
    const toolServer = extractServerName(clean);
    return { type: "mcp", text: line, clean, toolName, toolServer, toolStatus: "pending" };
  }
  if (TOOL_RESULT_RE.test(clean)) {
    const isError = /✗/.test(clean);
    return { type: "mcp", text: line, clean, toolStatus: isError ? "error" : "success" };
  }
  if (FILE_EDIT_RE.test(clean)) {
    const filePath = extractFilePath(clean);
    const fileOp = extractFileOp(clean);
    return { type: "file", text: line, clean, filePath, fileOp };
  }
  if (ERROR_RE.test(clean)) {
    return { type: "error", text: line, clean };
  }
  return { type: "main", text: line, clean };
}
function feedData(raw, state) {
  const combined = state.lineBuffer + raw;
  const newlineIndex = combined.lastIndexOf("\n");
  if (newlineIndex === -1) {
    state.lineBuffer = combined;
    return [];
  }
  const complete = combined.slice(0, newlineIndex);
  state.lineBuffer = combined.slice(newlineIndex + 1);
  const lines = complete.split("\n");
  const chunks = [];
  for (const line of lines) {
    chunks.push(classifyLine(line, state));
  }
  return chunks;
}
function createParser() {
  const state = {
    currentAgentId: null,
    agentCounter: 0,
    lineBuffer: ""
  };
  return {
    feed(raw) {
      return feedData(raw, state);
    }
  };
}

// src/layout.ts
var RIGHT_COLUMN_MIN_COLS = 30;
var RIGHT_COLUMN_RATIO = 0.35;
var COMPACT_COLS_THRESHOLD = 60;
var COMPACT_ROWS_THRESHOLD = 15;
function zeroRect() {
  return { left: 0, top: 0, width: 0, height: 0 };
}
function splitRightColumn(rightLeft, rightTop, rightWidth, rightHeight) {
  const third = Math.floor(rightHeight / 3);
  const remainder = rightHeight - third * 3;
  const thinking = {
    left: rightLeft,
    top: rightTop,
    width: rightWidth,
    height: third
  };
  const mcp = {
    left: rightLeft,
    top: rightTop + third,
    width: rightWidth,
    height: third
  };
  const files = {
    left: rightLeft,
    top: rightTop + third * 2,
    width: rightWidth,
    height: third + remainder
  };
  return [thinking, mcp, files];
}
function calculateLayout(cols, rows, state, agentCount) {
  const isCompact = state === "compact" || cols < COMPACT_COLS_THRESHOLD || rows < COMPACT_ROWS_THRESHOLD;
  const header = { left: 0, top: 0, width: cols, height: 1 };
  if (isCompact) {
    const main3 = {
      left: 0,
      top: 1,
      width: cols,
      height: Math.max(1, rows - 2)
    };
    const input2 = {
      left: 0,
      top: rows - 1,
      width: cols,
      height: 1
    };
    return {
      header,
      main: main3,
      thinking: zeroRect(),
      mcp: zeroRect(),
      files: zeroRect(),
      agents: [],
      input: input2,
      rightTab: zeroRect(),
      tabBar: zeroRect()
    };
  }
  const ratio = cols < 120 ? 0.28 : RIGHT_COLUMN_RATIO;
  const rightWidth = Math.max(RIGHT_COLUMN_MIN_COLS, Math.floor(cols * ratio));
  const leftWidth = cols - rightWidth;
  const rightTop = 1;
  const rightHeight = rows - 1;
  const [thinking, mcp, files] = splitRightColumn(leftWidth, rightTop, rightWidth, rightHeight);
  const tabBar = { left: leftWidth, top: 1, width: rightWidth, height: 1 };
  const rightTab = { left: leftWidth, top: 2, width: rightWidth, height: rows - 2 };
  const input = {
    left: 0,
    top: rows - 1,
    width: leftWidth,
    height: 1
  };
  const leftContentTop = 1;
  const leftContentBottom = rows - 2;
  const leftContentHeight = leftContentBottom - leftContentTop + 1;
  if (state === "solo" || agentCount === 0) {
    const main3 = {
      left: 0,
      top: leftContentTop,
      width: leftWidth,
      height: leftContentHeight
    };
    return { header, main: main3, thinking, mcp, files, agents: [], input, rightTab, tabBar };
  }
  if (state === "single" || agentCount === 1) {
    const agentHeight = Math.max(5, Math.floor(leftContentHeight * 0.35));
    const mainHeight2 = leftContentHeight - agentHeight;
    const main3 = {
      left: 0,
      top: leftContentTop,
      width: leftWidth,
      height: mainHeight2
    };
    const agent12 = {
      left: 0,
      top: leftContentTop + mainHeight2,
      width: leftWidth,
      height: agentHeight
    };
    return { header, main: main3, thinking, mcp, files, agents: [agent12], input, rightTab, tabBar };
  }
  const agentAreaHeight = Math.max(5, Math.floor(leftContentHeight * 0.4));
  const mainHeight = leftContentHeight - agentAreaHeight;
  const agentWidth = Math.floor(leftWidth / 2);
  const agent2Width = leftWidth - agentWidth;
  const main2 = {
    left: 0,
    top: leftContentTop,
    width: leftWidth,
    height: mainHeight
  };
  const agent1 = {
    left: 0,
    top: leftContentTop + mainHeight,
    width: agentWidth,
    height: agentAreaHeight
  };
  const agent2 = {
    left: agentWidth,
    top: leftContentTop + mainHeight,
    width: agent2Width,
    height: agentAreaHeight
  };
  return { header, main: main2, thinking, mcp, files, agents: [agent1, agent2], input, rightTab, tabBar };
}

// src/hooks/hook-server.ts
import * as net from "net";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
function getIpcPath(sessionId) {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mission-control-${sessionId}`;
  }
  return path.join(os.tmpdir(), `mission-control-${sessionId}.sock`);
}
function removeSocketFile(socketPath) {
  if (process.platform === "win32") {
    return;
  }
  try {
    fs.unlinkSync(socketPath);
  } catch {
  }
}
function parseHookMessage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || !("hookType" in parsed) || !("timestamp" in parsed) || !("payload" in parsed)) {
    return null;
  }
  const msg = parsed;
  const hookType = msg["hookType"];
  if (hookType !== "PreToolUse" && hookType !== "PostToolUse" && hookType !== "Stop") {
    return null;
  }
  return parsed;
}
function extractAgentSpawnFields(toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) {
    return {};
  }
  const input = toolInput;
  return {
    agentType: typeof input["agentType"] === "string" ? input["agentType"] : void 0,
    agentPrompt: typeof input["agentPrompt"] === "string" ? input["agentPrompt"] : void 0,
    agentModel: typeof input["agentModel"] === "string" ? input["agentModel"] : void 0
  };
}
function extractAgentDoneFields(toolOutput) {
  if (typeof toolOutput !== "object" || toolOutput === null) {
    return {};
  }
  const output = toolOutput;
  return {
    agentOutput: typeof output["agentOutput"] === "string" ? output["agentOutput"] : void 0,
    confidence: typeof output["confidence"] === "number" ? output["confidence"] : void 0
  };
}
function convertToHookEvent(message) {
  const { hookType, timestamp, payload } = message;
  const isAgentTool = payload.tool_name === "Agent";
  if (hookType === "Stop") {
    return { type: "stop", timestamp };
  }
  if (hookType === "PreToolUse") {
    if (isAgentTool) {
      return {
        type: "agent_spawn",
        toolName: payload.tool_name,
        serverName: payload.server_name,
        timestamp,
        ...extractAgentSpawnFields(payload.tool_input)
      };
    }
    return {
      type: "tool_start",
      toolName: payload.tool_name,
      toolInput: payload.tool_input,
      serverName: payload.server_name,
      timestamp
    };
  }
  if (isAgentTool) {
    return {
      type: "agent_done",
      toolName: payload.tool_name,
      toolSuccess: payload.tool_success,
      serverName: payload.server_name,
      timestamp,
      ...extractAgentDoneFields(payload.tool_output)
    };
  }
  return {
    type: "tool_end",
    toolName: payload.tool_name,
    toolOutput: payload.tool_output,
    toolSuccess: payload.tool_success,
    serverName: payload.server_name,
    timestamp
  };
}
function createHookServer() {
  let server = null;
  let resolvedIpcPath = "";
  const eventCallbacks = [];
  function emitEvent(event) {
    for (const cb of eventCallbacks) {
      cb(event);
    }
  }
  function handleConnection(socket) {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const raw = buffer.slice(0, newlineIndex).trim();
      socket.destroy();
      const message = parseHookMessage(raw);
      if (message === null) {
        return;
      }
      emitEvent(convertToHookEvent(message));
    });
    socket.on("error", () => {
      socket.destroy();
    });
  }
  return {
    get ipcPath() {
      return resolvedIpcPath;
    },
    start(sessionId) {
      resolvedIpcPath = getIpcPath(sessionId);
      removeSocketFile(resolvedIpcPath);
      return new Promise((resolve3, reject) => {
        server = net.createServer(handleConnection);
        server.on("error", reject);
        server.listen(resolvedIpcPath, () => {
          resolve3();
        });
      });
    },
    stop() {
      return new Promise((resolve3, reject) => {
        if (server === null) {
          resolve3();
          return;
        }
        server.close((err) => {
          server = null;
          removeSocketFile(resolvedIpcPath);
          if (err) {
            reject(err);
          } else {
            resolve3();
          }
        });
      });
    },
    onEvent(callback) {
      eventCallbacks.push(callback);
    }
  };
}

// src/hooks/hook-installer.ts
import * as fs2 from "fs";
import * as path2 from "path";
import * as os2 from "os";
var MC_HOOK_MARKER = "mission-control-hook";
function settingsPath(cwd) {
  return path2.join(cwd, ".claude", "settings.local.json");
}
function backupPath(settingsFile) {
  return settingsFile + ".mc-backup";
}
function lockFilePath() {
  return path2.join(os2.tmpdir(), `mission-control-${process.pid}.lock`);
}
function readSettings(filePath) {
  try {
    const raw = fs2.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function writeSettings(filePath, settings) {
  const dir = path2.dirname(filePath);
  if (!fs2.existsSync(dir)) {
    fs2.mkdirSync(dir, { recursive: true });
  }
  fs2.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf8");
}
function buildHookCommand(hookScriptPath, hookType) {
  return `node ${hookScriptPath} ${hookType}`;
}
function buildHookEntry(hookScriptPath, hookType, ipcPath) {
  return {
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `MC_IPC_PATH=${ipcPath} MC_HOOK_ID=${MC_HOOK_MARKER} ${buildHookCommand(hookScriptPath, hookType)}`
      }
    ]
  };
}
function isMcHookEntry(entry) {
  if (typeof entry !== "object" || entry === null) return false;
  const obj = entry;
  if (!Array.isArray(obj["hooks"])) return false;
  const hooks = obj["hooks"];
  return hooks.some((h) => {
    if (typeof h !== "object" || h === null) return false;
    const hook = h;
    return typeof hook["command"] === "string" && hook["command"].includes(MC_HOOK_MARKER);
  });
}
function stripMcEntries(hooks) {
  return hooks.filter((entry) => !isMcHookEntry(entry));
}
function injectHookEntry(hooks, hookType, entry) {
  const existing = Array.isArray(hooks[hookType]) ? hooks[hookType] : [];
  const cleaned = stripMcEntries(existing);
  hooks[hookType] = [...cleaned, entry];
}
function createHookInstaller(cwd) {
  const sPath = settingsPath(cwd);
  const bPath = backupPath(sPath);
  const lPath = lockFilePath();
  return {
    install(ipcPath, hookScriptPath) {
      const settings = readSettings(sPath);
      if (!fs2.existsSync(bPath)) {
        writeSettings(bPath, settings);
      }
      const hooks = typeof settings["hooks"] === "object" && settings["hooks"] !== null ? settings["hooks"] : {};
      injectHookEntry(hooks, "PreToolUse", buildHookEntry(hookScriptPath, "PreToolUse", ipcPath));
      injectHookEntry(hooks, "PostToolUse", buildHookEntry(hookScriptPath, "PostToolUse", ipcPath));
      injectHookEntry(hooks, "Stop", buildHookEntry(hookScriptPath, "Stop", ipcPath));
      settings["hooks"] = hooks;
      writeSettings(sPath, settings);
      fs2.writeFileSync(lPath, String(process.pid), "utf8");
      return sPath;
    },
    uninstall() {
      try {
        if (fs2.existsSync(bPath)) {
          fs2.copyFileSync(bPath, sPath);
          fs2.unlinkSync(bPath);
        } else {
          const settings = readSettings(sPath);
          const hooks = typeof settings["hooks"] === "object" && settings["hooks"] !== null ? settings["hooks"] : {};
          for (const hookType of ["PreToolUse", "PostToolUse", "Stop"]) {
            if (Array.isArray(hooks[hookType])) {
              hooks[hookType] = stripMcEntries(hooks[hookType]);
            }
          }
          settings["hooks"] = hooks;
          writeSettings(sPath, settings);
        }
      } catch {
      }
      try {
        fs2.unlinkSync(lPath);
      } catch {
      }
    },
    recoverFromCrash() {
      const tmpDir = os2.tmpdir();
      let entries;
      try {
        entries = fs2.readdirSync(tmpDir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.startsWith("mission-control-") || !entry.endsWith(".lock")) continue;
        const fullPath = path2.join(tmpDir, entry);
        let pid;
        try {
          pid = parseInt(fs2.readFileSync(fullPath, "utf8").trim(), 10);
        } catch {
          continue;
        }
        let alive = false;
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
        if (!alive) {
          if (fs2.existsSync(bPath)) {
            try {
              fs2.copyFileSync(bPath, sPath);
              fs2.unlinkSync(bPath);
            } catch {
            }
          }
          try {
            fs2.unlinkSync(fullPath);
          } catch {
          }
        }
      }
    }
  };
}

// src/watchers/file-watcher.ts
import { watch } from "chokidar";
import * as path3 from "path";
function isIgnoredPath(filePath) {
  const segments = filePath.split(path3.sep);
  if (segments.includes("node_modules")) return true;
  if (segments.includes(".git")) return true;
  if (segments.includes("dist")) return true;
  if (filePath.endsWith(".lock")) return true;
  if (segments.includes(".DS_Store")) return true;
  return false;
}
var DEDUP_WINDOW_MS = 500;
var CHOKIDAR_EVENT_MAP = {
  add: "A",
  change: "M",
  unlink: "D"
};
function createFileWatcher() {
  let watcher = null;
  let watchedCwd = "";
  const callbacks = [];
  const dedupMap = /* @__PURE__ */ new Map();
  function buildDedupKey(filePath, changeType) {
    return `${changeType}:${filePath}`;
  }
  function isDuplicate(dedupKey, now) {
    const last = dedupMap.get(dedupKey);
    return last !== void 0 && now - last < DEDUP_WINDOW_MS;
  }
  function handleChokidarEvent(eventName, absolutePath) {
    const changeType = CHOKIDAR_EVENT_MAP[eventName];
    if (changeType === void 0) {
      return;
    }
    const filePath = path3.relative(watchedCwd, absolutePath);
    const now = Date.now();
    const dedupKey = buildDedupKey(filePath, changeType);
    if (isDuplicate(dedupKey, now)) {
      return;
    }
    dedupMap.set(dedupKey, now);
    const event = { filePath, changeType, timestamp: now };
    for (const cb of callbacks) {
      cb(event);
    }
  }
  return {
    start(cwd) {
      watchedCwd = cwd;
      watcher = watch(cwd, {
        ignored: (p) => isIgnoredPath(path3.relative(cwd, p)),
        ignoreInitial: true,
        persistent: true,
        depth: 5
      });
      watcher.on("add", (p) => {
        handleChokidarEvent("add", p);
      });
      watcher.on("change", (p) => {
        handleChokidarEvent("change", p);
      });
      watcher.on("unlink", (p) => {
        handleChokidarEvent("unlink", p);
      });
      watcher.on("error", () => {
      });
    },
    async stop() {
      if (watcher !== null) {
        await watcher.close();
        watcher = null;
      }
      dedupMap.clear();
    },
    onChange(callback) {
      callbacks.push(callback);
    }
  };
}

// src/theme.ts
function hexToFg(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1B[38;2;${r};${g};${b}m`;
}
function hexToBg(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1B[48;2;${r};${g};${b}m`;
}
var palette = {
  bg: "#0d1117",
  headerBg: "#161b22",
  borderDefault: "#21262d",
  textPrimary: "#c9d1d9",
  textSecondary: "#8b949e",
  textDim: "#484f58",
  main: "#58a6ff",
  agent: "#bc8cff",
  thinking: "#f0c050",
  mcp: "#5dca7a",
  files: "#f06080",
  error: "#f85149",
  success: "#5dca7a",
  warning: "#f0c050"
};
var fg = {
  bg: hexToFg(palette.bg),
  headerBg: hexToFg(palette.headerBg),
  borderDefault: hexToFg(palette.borderDefault),
  textPrimary: hexToFg(palette.textPrimary),
  textSecondary: hexToFg(palette.textSecondary),
  textDim: hexToFg(palette.textDim),
  main: hexToFg(palette.main),
  agent: hexToFg(palette.agent),
  thinking: hexToFg(palette.thinking),
  mcp: hexToFg(palette.mcp),
  files: hexToFg(palette.files),
  error: hexToFg(palette.error),
  success: hexToFg(palette.success),
  warning: hexToFg(palette.warning)
};
var bg = {
  bg: hexToBg(palette.bg),
  headerBg: hexToBg(palette.headerBg),
  borderDefault: hexToBg(palette.borderDefault),
  textPrimary: hexToBg(palette.textPrimary),
  textSecondary: hexToBg(palette.textSecondary),
  textDim: hexToBg(palette.textDim),
  main: hexToBg(palette.main),
  agent: hexToBg(palette.agent),
  thinking: hexToBg(palette.thinking),
  mcp: hexToBg(palette.mcp),
  files: hexToBg(palette.files),
  error: hexToBg(palette.error),
  success: hexToBg(palette.success),
  warning: hexToBg(palette.warning)
};
var icons = {
  success: "\u2713",
  error: "\u2717",
  pending: "\u27F3",
  dot: "\u25CF",
  arrow: "\u2192",
  spawn: "\u229E"
};

// src/orchestrator.ts
var RESET2 = "\x1B[0m";
var BOLD = "\x1B[1m";
var DIM = "\x1B[2m";
function createOrchestrator() {
  const agents = [];
  const recentTools = [];
  const MAX_RECENT_TOOLS = 20;
  let totalTools = 0;
  let sessionStart = Date.now();
  function addAgent(event) {
    const agent = {
      id: `agent-${agents.length + 1}`,
      type: event.agentType ?? "unknown",
      prompt: event.agentPrompt?.slice(0, 80) ?? "",
      model: event.agentModel ?? "",
      status: "running",
      spawnedAt: event.timestamp,
      toolCalls: 0
    };
    agents.push(agent);
  }
  function completeLastAgent(event) {
    const running = agents.filter((a) => a.status === "running");
    const last = running[running.length - 1];
    if (last) {
      last.status = event.toolSuccess === false ? "error" : "done";
      last.completedAt = event.timestamp;
      last.confidence = event.confidence;
      last.output = event.agentOutput?.slice(0, 100);
    }
  }
  function addToolCall(event) {
    totalTools++;
    const tool = {
      name: event.toolName ?? "unknown",
      status: "pending",
      timestamp: event.timestamp
    };
    recentTools.push(tool);
    if (recentTools.length > MAX_RECENT_TOOLS) {
      recentTools.shift();
    }
    const running = agents.filter((a) => a.status === "running");
    const current = running[running.length - 1];
    if (current) {
      current.toolCalls++;
    }
  }
  function completeToolCall(event) {
    const pending = recentTools.filter((t) => t.status === "pending" && t.name === event.toolName);
    const match = pending[pending.length - 1];
    if (match) {
      match.status = event.toolSuccess === false ? "error" : "success";
    }
  }
  function formatDuration(ms) {
    const secs = Math.floor(ms / 1e3);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return `${mins}m${remainSecs}s`;
  }
  function statusIcon(status) {
    if (status === "running") return `${fg.success}${icons.pending}${RESET2}`;
    if (status === "done") return `${fg.success}${icons.success}${RESET2}`;
    if (status === "error") return `${fg.error}${icons.error}${RESET2}`;
    if (status === "pending") return `${fg.thinking}${icons.pending}${RESET2}`;
    if (status === "success") return `${fg.success}${icons.success}${RESET2}`;
    return `${fg.textDim}?${RESET2}`;
  }
  function renderAgentTree() {
    const lines = [];
    lines.push(`${BOLD}${fg.agent} Agent Tree${RESET2}`);
    if (agents.length === 0) {
      lines.push(`${DIM}  (no agents spawned)${RESET2}`);
      return lines;
    }
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const isLast = i === agents.length - 1;
      const connector = isLast ? "\u2514\u2500" : "\u251C\u2500";
      const icon = statusIcon(a.status);
      const duration = a.completedAt ? formatDuration(a.completedAt - a.spawnedAt) : formatDuration(Date.now() - a.spawnedAt);
      const conf = a.confidence !== void 0 ? ` ${fg.textDim}${a.confidence}%${RESET2}` : "";
      const model = a.model ? ` ${fg.textDim}(${a.model})${RESET2}` : "";
      lines.push(`  ${connector} ${icon} ${fg.agent}${a.type}${RESET2}${model} ${fg.textDim}${duration}${RESET2}${conf}`);
      if (a.prompt) {
        const subConnector = isLast ? "   " : "\u2502  ";
        lines.push(`  ${subConnector} ${fg.textDim}${icons.arrow} ${a.prompt}${RESET2}`);
      }
      if (a.toolCalls > 0) {
        const subConnector = isLast ? "   " : "\u2502  ";
        lines.push(`  ${subConnector} ${fg.textDim}${a.toolCalls} tools${RESET2}`);
      }
      if (a.output && a.status === "done") {
        const subConnector = isLast ? "   " : "\u2502  ";
        lines.push(`  ${subConnector} ${fg.success}${a.output}${RESET2}`);
      }
    }
    return lines;
  }
  function renderToolFeed() {
    const lines = [];
    lines.push("");
    lines.push(`${BOLD}${fg.mcp} Recent Tools${RESET2} ${fg.textDim}(${totalTools} total)${RESET2}`);
    if (recentTools.length === 0) {
      lines.push(`${DIM}  (no tool calls yet)${RESET2}`);
      return lines;
    }
    const visible = recentTools.slice(-10);
    for (const t of visible) {
      lines.push(`  ${statusIcon(t.status)} ${t.name}`);
    }
    return lines;
  }
  function renderStats() {
    const elapsed = formatDuration(Date.now() - sessionStart);
    const activeCount = agents.filter((a) => a.status === "running").length;
    const doneCount = agents.filter((a) => a.status === "done").length;
    const errorCount = agents.filter((a) => a.status === "error").length;
    const lines = [];
    lines.push("");
    lines.push(`${BOLD}${fg.textPrimary} Session${RESET2}`);
    lines.push(`  ${fg.textDim}Duration:${RESET2} ${elapsed}`);
    lines.push(`  ${fg.textDim}Agents:${RESET2} ${fg.success}${activeCount} running${RESET2} ${fg.textDim}${doneCount} done${RESET2}${errorCount > 0 ? ` ${fg.error}${errorCount} error${RESET2}` : ""}`);
    lines.push(`  ${fg.textDim}Tools:${RESET2} ${totalTools} total`);
    return lines;
  }
  return {
    handleEvent(event) {
      if (event.type === "agent_spawn") {
        addAgent(event);
      } else if (event.type === "agent_done") {
        completeLastAgent(event);
      } else if (event.type === "tool_start") {
        addToolCall(event);
      } else if (event.type === "tool_end") {
        completeToolCall(event);
      }
    },
    render() {
      return [
        ...renderAgentTree(),
        ...renderToolFeed(),
        ...renderStats()
      ];
    },
    get activeAgentCount() {
      return agents.filter((a) => a.status === "running").length;
    },
    get totalToolCalls() {
      return totalTools;
    }
  };
}

// src/web-viewer.ts
var RESET3 = "\x1B[0m";
var BOLD2 = "\x1B[1m";
var DIM2 = "\x1B[2m";
var UNDERLINE = "\x1B[4m";
function htmlToText(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "");
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, `
${BOLD2}$1${RESET3}
`);
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, `
${BOLD2}$1${RESET3}
`);
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, `
${BOLD2}$1${RESET3}
`);
  text = text.replace(/<h[4-6][^>]*>(.*?)<\/h[4-6]>/gi, `
$1
`);
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, `${UNDERLINE}$2${RESET3} ${DIM2}($1)${RESET3}`);
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, "  - $1\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/tr>/gi, "\n");
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, `${fg.mcp}$1${RESET3}`);
  text = text.replace(/<pre[^>]*>(.*?)<\/pre>/gis, `
${fg.textDim}$1${RESET3}
`);
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, `${BOLD2}$1${RESET3}`);
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, `${BOLD2}$1${RESET3}`);
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, `$1`);
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");
  const lines = text.split("\n").map((l) => l.trim()).filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));
  return lines;
}
function createWebViewer() {
  let lines = [`${DIM2}  Type a URL to browse${RESET3}`, `${DIM2}  Example: https://docs.anthropic.com${RESET3}`];
  let currentUrl = "";
  let loading = false;
  const urlHistory = [];
  return {
    async fetch(url) {
      let normalizedUrl = url.trim();
      if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
        normalizedUrl = "https://" + normalizedUrl;
      }
      currentUrl = normalizedUrl;
      loading = true;
      lines = [`${fg.thinking}${icons.pending} Loading ${normalizedUrl}...${RESET3}`];
      try {
        const response = await globalThis.fetch(normalizedUrl, {
          headers: { "User-Agent": "Claude-Mission-Control/0.1" },
          signal: AbortSignal.timeout(1e4)
        });
        if (!response.ok) {
          lines = [
            `${fg.error}${icons.error} HTTP ${response.status} ${response.statusText}${RESET3}`,
            `${DIM2}  URL: ${normalizedUrl}${RESET3}`
          ];
          loading = false;
          return;
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
          lines = [
            `${fg.thinking}${icons.arrow} ${contentType}${RESET3}`,
            `${DIM2}  Content type not supported for text rendering${RESET3}`,
            `${DIM2}  URL: ${normalizedUrl}${RESET3}`
          ];
          loading = false;
          return;
        }
        const html = await response.text();
        const titleMatch = /<title[^>]*>(.*?)<\/title>/i.exec(html);
        const title = titleMatch?.[1]?.trim() ?? normalizedUrl;
        const textLines = htmlToText(html);
        lines = [
          `${BOLD2}${fg.main}${title}${RESET3}`,
          `${DIM2}${normalizedUrl}${RESET3}`,
          "",
          ...textLines
        ];
        urlHistory.push(normalizedUrl);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        lines = [
          `${fg.error}${icons.error} Failed to fetch${RESET3}`,
          `${DIM2}  ${errMsg}${RESET3}`,
          `${DIM2}  URL: ${normalizedUrl}${RESET3}`
        ];
      }
      loading = false;
    },
    getLines() {
      return lines;
    },
    get currentUrl() {
      return currentUrl;
    },
    get loading() {
      return loading;
    },
    get history() {
      return [...urlHistory];
    }
  };
}

// src/memory/project-memory.ts
import * as fs3 from "fs";
import * as path4 from "path";
import * as crypto from "crypto";
var DEFAULT_MAX_CONTEXT_CHARS = 8e3;
function generateId() {
  return crypto.randomBytes(6).toString("hex");
}
function ensureDir(dirPath) {
  if (!fs3.existsSync(dirPath)) {
    fs3.mkdirSync(dirPath, { recursive: true });
  }
}
function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs3.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(filePath, data) {
  fs3.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function textScore(text, query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (lower.includes(word)) score++;
  }
  return score;
}
function createProjectMemory(projectDir) {
  const mcDir = path4.join(projectDir, ".mc");
  const memDir = path4.join(mcDir, "memory");
  const sessionsDir = path4.join(mcDir, "sessions");
  const entriesFile = path4.join(memDir, "entries.json");
  const filesFile = path4.join(memDir, "tracked-files.json");
  let entries = [];
  let trackedFiles = {};
  return {
    get memoryDir() {
      return mcDir;
    },
    load() {
      ensureDir(memDir);
      ensureDir(sessionsDir);
      entries = readJson(entriesFile, []);
      trackedFiles = readJson(filesFile, {});
    },
    save(input) {
      const now = Date.now();
      const entry = {
        ...input,
        id: generateId(),
        createdAt: now,
        updatedAt: now
      };
      entries.push(entry);
      ensureDir(memDir);
      writeJson(entriesFile, entries);
      return entry;
    },
    update(id, updates) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      if (updates.title !== void 0) entry.title = updates.title;
      if (updates.content !== void 0) entry.content = updates.content;
      if (updates.tags !== void 0) entry.tags = updates.tags;
      if (updates.relevance !== void 0) entry.relevance = updates.relevance;
      entry.updatedAt = Date.now();
      writeJson(entriesFile, entries);
    },
    search(query, limit = 10) {
      const scored = entries.map((entry) => ({
        entry,
        score: textScore(`${entry.title} ${entry.content} ${entry.tags.join(" ")}`, query) + entry.relevance
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).filter((s) => s.score > 0).map((s) => s.entry);
    },
    getAll() {
      return [...entries];
    },
    getByType(type) {
      return entries.filter((e) => e.type === type);
    },
    saveSession(summary) {
      const session = { ...summary, id: generateId() };
      ensureDir(sessionsDir);
      const sessionFile = path4.join(sessionsDir, `${session.id}.json`);
      writeJson(sessionFile, session);
    },
    getSessions() {
      ensureDir(sessionsDir);
      const sessions = [];
      let files;
      try {
        files = fs3.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
      } catch {
        return sessions;
      }
      for (const file of files) {
        const session = readJson(path4.join(sessionsDir, file), null);
        if (session) sessions.push(session);
      }
      sessions.sort((a, b) => b.startedAt - a.startedAt);
      return sessions;
    },
    buildContext(maxChars = DEFAULT_MAX_CONTEXT_CHARS) {
      const sections = [];
      const recentSessions = this.getSessions().slice(0, 3);
      if (recentSessions.length > 0) {
        sections.push("## Recent Sessions");
        for (const s of recentSessions) {
          const date = new Date(s.startedAt).toISOString().split("T")[0];
          sections.push(`- ${date}: ${s.summary} (${s.agentsUsed} agents, ${s.toolCalls} tools, ${s.filesChanged.length} files)`);
        }
      }
      const archEntries = this.getByType("architecture");
      if (archEntries.length > 0) {
        sections.push("\n## Architecture");
        for (const e of archEntries.slice(0, 5)) {
          sections.push(`- ${e.title}: ${e.content.slice(0, 200)}`);
        }
      }
      const decisions = this.getByType("decision");
      if (decisions.length > 0) {
        sections.push("\n## Decisions");
        for (const e of decisions.slice(0, 5)) {
          sections.push(`- ${e.title}: ${e.content.slice(0, 200)}`);
        }
      }
      const patterns = this.getByType("pattern");
      if (patterns.length > 0) {
        sections.push("\n## Patterns");
        for (const e of patterns.slice(0, 5)) {
          sections.push(`- ${e.title}: ${e.content.slice(0, 200)}`);
        }
      }
      const fileKeys = Object.keys(trackedFiles);
      if (fileKeys.length > 0) {
        sections.push("\n## Important Files");
        for (const file of fileKeys.slice(0, 15)) {
          const reasons = trackedFiles[file] ?? [];
          sections.push(`- ${file}: ${reasons[reasons.length - 1] ?? ""}`);
        }
      }
      let context = sections.join("\n");
      if (context.length > maxChars) {
        context = context.slice(0, maxChars - 3) + "...";
      }
      return context;
    },
    trackFile(filePath, reason) {
      const relative3 = path4.relative(projectDir, path4.resolve(projectDir, filePath));
      const existing = trackedFiles[relative3] ?? [];
      trackedFiles[relative3] = [...existing.slice(-4), reason];
      ensureDir(memDir);
      writeJson(filesFile, trackedFiles);
    }
  };
}

// src/memory/session-collector.ts
function createSessionCollector(memory) {
  const startedAt = Date.now();
  const toolNames = /* @__PURE__ */ new Set();
  const filesChanged = /* @__PURE__ */ new Set();
  const agentTypes = /* @__PURE__ */ new Set();
  const thinkingSnippets = [];
  let toolCalls = 0;
  let errors = 0;
  return {
    recordHookEvent(event) {
      if (event.type === "tool_start") {
        toolCalls++;
        if (event.toolName) toolNames.add(event.toolName);
      }
      if (event.type === "agent_spawn") {
        if (event.agentType) agentTypes.add(event.agentType);
      }
    },
    recordChunk(chunk) {
      if (chunk.type === "thinking" && chunk.clean.length > 10) {
        if (thinkingSnippets.length < 20) {
          thinkingSnippets.push(chunk.clean.slice(0, 100));
        }
      }
      if (chunk.type === "file" && chunk.filePath) {
        filesChanged.add(chunk.filePath);
        memory.trackFile(chunk.filePath, `${chunk.fileOp ?? "M"} during session`);
      }
      if (chunk.type === "error") {
        errors++;
      }
      if (chunk.type === "mcp" && chunk.toolName) {
        toolCalls++;
        toolNames.add(chunk.toolName);
      }
    },
    recordFileChange(filePath, changeType) {
      filesChanged.add(filePath);
      memory.trackFile(filePath, `${changeType} detected by watcher`);
    },
    finalize() {
      const endedAt = Date.now();
      const toolList = [...toolNames].join(", ");
      const agentList = [...agentTypes].join(", ");
      const fileList = [...filesChanged].slice(0, 10);
      const thinkingTopics = thinkingSnippets.slice(0, 5);
      const summaryParts = [];
      if (toolCalls > 0) summaryParts.push(`${toolCalls} tool calls (${toolList})`);
      if (agentTypes.size > 0) summaryParts.push(`agents: ${agentList}`);
      if (filesChanged.size > 0) summaryParts.push(`${filesChanged.size} files changed`);
      if (errors > 0) summaryParts.push(`${errors} errors`);
      const summary = {
        startedAt,
        endedAt,
        agentsUsed: agentTypes.size,
        toolCalls,
        filesChanged: fileList,
        thinkingTopics,
        summary: summaryParts.join("; ") || "short session"
      };
      memory.saveSession(summary);
    },
    get stats() {
      return {
        agentsUsed: agentTypes.size,
        toolCalls,
        filesChanged: filesChanged.size,
        thinkingLines: thinkingSnippets.length,
        errors,
        duration: Date.now() - startedAt
      };
    }
  };
}

// src/index.ts
var TAB_NAMES = ["Think", "Tools", "Files", "Orch", "Web"];
var RENDER_INTERVAL_MS = 33;
var WINDOWS_RESIZE_POLL_MS = 500;
var MAX_VISIBLE_AGENT_PANES = 2;
var DOUBLE_CTRLC_MS = 500;
function enterAlternateScreen() {
  process.stdout.write("\x1B[?1049h");
}
function leaveAlternateScreen() {
  process.stdout.write("\x1B[?1049l");
}
function hideCursor() {
  process.stdout.write("\x1B[?25l");
}
function showCursor() {
  process.stdout.write("\x1B[?25h");
}
function termSize() {
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24
  };
}
function formatFileChange(chunk) {
  const opLabel = chunk.fileOp === "A" ? fg.success + "+" : chunk.fileOp === "D" ? fg.error + "-" : fg.main + "M";
  const filePath = chunk.filePath ?? "";
  const reset = "\x1B[0m";
  return `${opLabel}${reset} ${filePath}`;
}
function truncate(s, max) {
  const clean = s.replace(/[\n\r]+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max - 1) + "\u2026" : clean;
}
function previewValue(val, max = 60) {
  if (val === void 0 || val === null) return "";
  if (typeof val === "string") return truncate(val, max);
  try {
    return truncate(JSON.stringify(val), max);
  } catch {
    return "";
  }
}
function formatHookToolLines(event) {
  const lines = [];
  const time = new Date(event.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  const name = event.toolName ?? "tool";
  const isMcp = event.serverName && event.serverName.length > 0;
  const RESET4 = "\x1B[0m";
  if (event.type === "tool_start") {
    const icon = `${fg.thinking}${icons.pending}${RESET4}`;
    const serverBadge = isMcp ? ` ${fg.mcp}[${event.serverName}]${RESET4}` : "";
    lines.push(`${icon} ${fg.textPrimary}${name}${RESET4}${serverBadge} ${fg.textDim}${time}${RESET4}`);
    const inputPreview = previewValue(event.toolInput);
    if (inputPreview) {
      lines.push(`  ${fg.textDim}${icons.arrow} ${inputPreview}${RESET4}`);
    }
  }
  if (event.type === "tool_end") {
    const success = event.toolSuccess !== false;
    const icon = success ? `${fg.success}${icons.success}${RESET4}` : `${fg.error}${icons.error}${RESET4}`;
    const serverBadge = isMcp ? ` ${fg.mcp}[${event.serverName}]${RESET4}` : "";
    lines.push(`${icon} ${fg.textPrimary}${name}${RESET4}${serverBadge} ${fg.textDim}${time}${RESET4}`);
    const outputPreview = previewValue(event.toolOutput);
    if (outputPreview) {
      const color = success ? fg.textDim : fg.error;
      lines.push(`  ${color}${icons.arrow} ${outputPreview}${RESET4}`);
    }
  }
  return lines;
}
function layoutStateForAgentCount(count) {
  if (count === 0) return "solo";
  if (count === 1) return "single";
  return "dual";
}
function findEvictableAgent(agents) {
  for (const [id, agent] of agents) {
    if (agent.status === "done") return id;
  }
  return null;
}
function buildHeaderContent(agentCount, toolCount, fileCount, hookConnected) {
  const dot = fg.error + icons.dot + "\x1B[0m";
  const greenDot = fg.success + icons.dot + "\x1B[0m";
  const title = fg.textPrimary + " Claude Mission Control\x1B[0m";
  const agentsBadge = ` ${greenDot} ${fg.textSecondary}${agentCount} agents\x1B[0m`;
  const toolsBadge = ` ${fg.textDim}${toolCount} tools\x1B[0m`;
  const filesBadge = ` ${fg.textDim}${fileCount} files\x1B[0m`;
  const hookBadge = hookConnected ? ` ${fg.success}hooks${"\x1B[0m"}` : ` ${fg.textDim}hooks:off${"\x1B[0m"}`;
  const keybinds = ` ${fg.textDim}esc=panels 1-5=tabs q=quit\x1B[0m`;
  return ` ${dot}${title} \u2502${agentsBadge} \u2502${toolsBadge} \u2502${filesBadge} \u2502${hookBadge} \u2502${keybinds}`;
}
function resolveWorkingDir() {
  const args = process.argv.slice(2);
  const cwdIndex = args.indexOf("--cwd");
  const cwdArg = cwdIndex !== -1 ? args[cwdIndex + 1] : void 0;
  if (cwdArg) {
    return path5.resolve(cwdArg);
  }
  const firstArg = args.find((a) => !a.startsWith("-"));
  if (firstArg && fs4.existsSync(firstArg)) {
    return path5.resolve(firstArg);
  }
  return process.cwd();
}
async function main() {
  enterAlternateScreen();
  hideCursor();
  const cwd = resolveWorkingDir();
  const sessionId = crypto2.randomBytes(4).toString("hex");
  const { cols, rows } = termSize();
  const screen = createScreenBuffer(cols, rows);
  const ptyManager = createPtyManager();
  const parser = createParser();
  const hookServer = createHookServer();
  const hookInstaller = createHookInstaller(cwd);
  const fileWatcher = createFileWatcher();
  const projectMemory = createProjectMemory(cwd);
  const sessionCollector = createSessionCollector(projectMemory);
  projectMemory.load();
  hookInstaller.recoverFromCrash();
  let hookConnected = false;
  try {
    await hookServer.start(sessionId);
    const selfDir = path5.dirname(new URL(import.meta.url).pathname);
    const hookInSrc = path5.resolve(selfDir, "hooks", "hook-forward.mjs");
    const hookInDist = path5.resolve(selfDir, "hook-forward.mjs");
    const hookScriptPath = fs4.existsSync(hookInSrc) ? hookInSrc : hookInDist;
    hookInstaller.install(hookServer.ipcPath, hookScriptPath);
    hookConnected = true;
  } catch {
    hookConnected = false;
  }
  let layoutState = "solo";
  let layout = calculateLayout(cols, rows, layoutState, 0);
  const mainPane = createTerminalPane(
    "main",
    "Claude Code",
    layout.main,
    fg.main
  );
  const thinkingPane = createTextPane(
    "thinking",
    "Thinking",
    layout.rightTab,
    fg.thinking,
    200
  );
  const mcpPane = createTextPane(
    "mcp",
    "Tools",
    layout.rightTab,
    fg.mcp,
    300
  );
  const filesPane = createTextPane(
    "files",
    "Files",
    layout.rightTab,
    fg.files,
    50
  );
  const orchestratorPane = createTextPane(
    "orchestrator",
    "Orchestrator",
    layout.rightTab,
    fg.agent,
    500
  );
  const browserPane = createTextPane(
    "browser",
    "Browser",
    layout.rightTab,
    fg.main,
    1e3
  );
  const orchestrator = createOrchestrator();
  const webViewer = createWebViewer();
  let activeTab = 0;
  const tabPanes = [thinkingPane, mcpPane, filesPane, orchestratorPane, browserPane];
  const agents = /* @__PURE__ */ new Map();
  const agentPanes = /* @__PURE__ */ new Map();
  const agentSlotOrder = [];
  let panelMode = false;
  let focusedPaneIndex = 0;
  let toolCount = 0;
  let fileCount = 0;
  let lastCtrlCTime = 0;
  let renderIntervalId = null;
  let windowsPollId = null;
  let hookAgentCounter = 0;
  function focusablePanes() {
    const panes = [mainPane];
    for (const id of agentSlotOrder) {
      const pane = agentPanes.get(id);
      if (pane) panes.push(pane);
    }
    panes.push(thinkingPane);
    return panes;
  }
  function applyFocus() {
    const panes = focusablePanes();
    panes.forEach((pane, index) => {
      pane.focused = panelMode && index === focusedPaneIndex;
    });
  }
  applyFocus();
  function recalculateLayout() {
    const { cols: c, rows: r } = termSize();
    screen.resize(c, r);
    layout = calculateLayout(c, r, layoutState, agentSlotOrder.length);
    mainPane.resize(layout.main);
    thinkingPane.rect = layout.rightTab;
    mcpPane.rect = layout.rightTab;
    filesPane.rect = layout.rightTab;
    orchestratorPane.rect = layout.rightTab;
    browserPane.rect = layout.rightTab;
    layout.agents.forEach((rect, index) => {
      const agentId = agentSlotOrder[index];
      if (agentId) {
        const pane = agentPanes.get(agentId);
        if (pane) pane.rect = rect;
      }
    });
  }
  function registerAgent(agentId, agentName) {
    const visibleCount = agentSlotOrder.length;
    if (visibleCount >= MAX_VISIBLE_AGENT_PANES) {
      const evictId = findEvictableAgent(agents);
      if (evictId) {
        agentSlotOrder.splice(agentSlotOrder.indexOf(evictId), 1);
        agentPanes.delete(evictId);
        agents.delete(evictId);
      } else {
        return;
      }
    }
    const agent = {
      id: agentId,
      name: agentName,
      status: "active",
      slot: agentSlotOrder.length,
      lines: []
    };
    agents.set(agentId, agent);
    agentSlotOrder.push(agentId);
    const newCount = agentSlotOrder.length;
    layoutState = layoutStateForAgentCount(newCount);
    recalculateLayout();
    const slotIndex = agentSlotOrder.indexOf(agentId);
    const rect = layout.agents[slotIndex] ?? { left: 0, top: 0, width: 0, height: 0 };
    const pane = createTextPane(agentId, agentName, rect, fg.agent, 500);
    agentPanes.set(agentId, pane);
    applyFocus();
  }
  function routeChunk(chunk) {
    sessionCollector.recordChunk(chunk);
    if (chunk.type === "thinking") {
      const effortMatch = /\(thinking with (\w+) effort\)/i.exec(chunk.clean);
      const verbMatch = /^\s*[*·•]\s*(\w+)/i.exec(chunk.clean);
      const durationMatch = /cogitated for (\d+s?)/i.exec(chunk.clean);
      if (durationMatch) {
        thinkingPane.appendLine(`${fg.success}${icons.success} Done${fg.textDim} (${durationMatch[1]})\x1B[0m`);
      } else if (verbMatch) {
        const verb = verbMatch[1] ?? "Thinking";
        const effort = effortMatch ? ` ${fg.textDim}[${effortMatch[1]}]\x1B[0m` : "";
        const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        thinkingPane.appendLine(`${fg.thinking}${icons.pending} ${verb}...${effort} ${fg.textDim}${time}\x1B[0m`);
      } else {
        thinkingPane.appendLine(`${fg.thinking}${chunk.clean}\x1B[0m`);
      }
      return;
    }
    if (chunk.type === "agent") {
      const agentId = chunk.agentId;
      if (!agentId) return;
      if (chunk.agentName && !agents.has(agentId)) {
        registerAgent(agentId, chunk.agentName);
        return;
      }
      const existingAgent = agents.get(agentId);
      if (existingAgent) {
        if (/done|complete|finished|returned/i.test(chunk.clean)) {
          existingAgent.status = "done";
          const pane = agentPanes.get(agentId);
          if (pane) pane.borderColor = fg.textDim;
        } else {
          existingAgent.lines.push(chunk.clean);
          agentPanes.get(agentId)?.appendLine(chunk.clean);
        }
      }
      return;
    }
    if (chunk.type === "mcp") {
      toolCount += 1;
      const time = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      const icon = chunk.toolStatus === "success" ? `${fg.success}${icons.success}\x1B[0m` : chunk.toolStatus === "error" ? `${fg.error}${icons.error}\x1B[0m` : `${fg.thinking}${icons.pending}\x1B[0m`;
      const name = chunk.toolName ?? "tool";
      const server = chunk.toolServer ? ` ${fg.mcp}[${chunk.toolServer}]\x1B[0m` : "";
      mcpPane.appendLine(`${icon} ${fg.textPrimary}${name}\x1B[0m${server} ${fg.textDim}${time}\x1B[0m`);
      if (chunk.clean && chunk.clean.length > 20) {
        mcpPane.appendLine(`  ${fg.textDim}${icons.arrow} ${truncate(chunk.clean, 60)}\x1B[0m`);
      }
      return;
    }
    if (chunk.type === "file") {
      fileCount += 1;
      filesPane.appendLine(formatFileChange(chunk));
      return;
    }
    if (chunk.type === "error") {
      mcpPane.appendLine(`${fg.error}${icons.error} ${chunk.clean}\x1B[0m`);
      return;
    }
  }
  function routeHookEvent(event) {
    orchestrator.handleEvent(event);
    sessionCollector.recordHookEvent(event);
    if (event.type === "tool_start" || event.type === "tool_end") {
      toolCount += 1;
      const lines = formatHookToolLines(event);
      for (const line of lines) {
        mcpPane.appendLine(line);
      }
      if (event.serverName && activeTab !== 1) {
        activeTab = 1;
      }
      return;
    }
    if (event.type === "agent_spawn") {
      hookAgentCounter += 1;
      const agentId = `hook-agent-${hookAgentCounter}`;
      const agentName = event.agentType ?? event.toolName ?? "Agent";
      registerAgent(agentId, agentName);
      if (event.agentPrompt) {
        agentPanes.get(agentId)?.appendLine(
          `${fg.textDim}${icons.arrow} ${event.agentPrompt.slice(0, 120)}\x1B[0m`
        );
      }
      return;
    }
    if (event.type === "agent_done") {
      const lastAgentId = agentSlotOrder[agentSlotOrder.length - 1];
      if (lastAgentId) {
        const existingAgent = agents.get(lastAgentId);
        if (existingAgent) {
          existingAgent.status = "done";
          const pane = agentPanes.get(lastAgentId);
          if (pane) {
            pane.borderColor = fg.textDim;
            if (event.agentOutput) {
              pane.appendLine(`${fg.success}${icons.success} done\x1B[0m`);
            }
          }
        }
      }
      return;
    }
  }
  function renderFrame() {
    const { cols: c, rows: r } = termSize();
    screen.clear();
    const headerContent = buildHeaderContent(agents.size, toolCount, fileCount, hookConnected);
    screen.writeAnsiString(0, 0, c, bg.headerBg + headerContent + "\x1B[0m");
    mainPane.renderTo(screen);
    for (const id of agentSlotOrder) {
      agentPanes.get(id)?.renderTo(screen);
    }
    if (activeTab === 3) {
      orchestratorPane.clear();
      for (const line of orchestrator.render()) {
        orchestratorPane.appendLine(line);
      }
    }
    if (activeTab === 4) {
      browserPane.clear();
      for (const line of webViewer.getLines()) {
        browserPane.appendLine(line);
      }
    }
    const tabBarRow = layout.tabBar.top;
    const tabBarLeft = layout.tabBar.left;
    const tabBarWidth = layout.tabBar.width;
    if (tabBarWidth > 0) {
      let tabStr = "";
      for (let i = 0; i < TAB_NAMES.length; i++) {
        const label = `${i + 1}:${TAB_NAMES[i]}`;
        if (i === activeTab) {
          tabStr += `${fg.main}\x1B[1m ${label} \x1B[0m`;
        } else {
          tabStr += `${fg.textDim} ${label} \x1B[0m`;
        }
        if (i < TAB_NAMES.length - 1) tabStr += `${fg.textDim}|`;
      }
      screen.writeAnsiString(tabBarRow, tabBarLeft, tabBarWidth, bg.headerBg + tabStr + "\x1B[0m");
    }
    const activePane = tabPanes[activeTab];
    if (activePane) {
      activePane.renderTo(screen);
    }
    const inputRow = r - 1;
    const leftWidth = layout.input.width;
    if (panelMode) {
      const hint = `${fg.main}[PANEL]${fg.textDim} \u2191\u2193=scroll tab=pane 1-5=tab esc=back\x1B[0m`;
      screen.writeAnsiString(inputRow, 0, leftWidth, hint);
    } else {
      const prompt = `${fg.textDim}${icons.dot} passthrough\x1B[0m`;
      screen.writeAnsiString(inputRow, 0, leftWidth, prompt);
    }
    screen.flush(process.stdout);
  }
  function handleKeyInput(data) {
    const key = data.toString("utf8");
    if (key === "") {
      const now = Date.now();
      if (now - lastCtrlCTime < DOUBLE_CTRLC_MS) {
        cleanup();
        process.exit(0);
      }
      lastCtrlCTime = now;
      ptyManager.write(key);
      return;
    }
    if (key === "\x1B" && data.length === 1) {
      panelMode = !panelMode;
      if (panelMode) {
        focusedPaneIndex = 0;
      }
      applyFocus();
      return;
    }
    if (panelMode) {
      if (key >= "1" && key <= "5") {
        activeTab = parseInt(key) - 1;
        return;
      }
      if (key === "q") {
        cleanup();
        process.exit(0);
      }
      if (key === "	") {
        const panes = focusablePanes();
        focusedPaneIndex = (focusedPaneIndex + 1) % panes.length;
        applyFocus();
        return;
      }
      if (key === "\x1B[A") {
        const panes = focusablePanes();
        panes[focusedPaneIndex]?.scrollUp?.();
        return;
      }
      if (key === "\x1B[B") {
        const panes = focusablePanes();
        panes[focusedPaneIndex]?.scrollDown?.();
        return;
      }
      return;
    }
    ptyManager.write(key);
  }
  function cleanup() {
    if (renderIntervalId !== null) clearInterval(renderIntervalId);
    if (windowsPollId !== null) clearInterval(windowsPollId);
    try {
      sessionCollector.finalize();
    } catch {
    }
    try {
      hookInstaller.uninstall();
    } catch {
    }
    try {
      hookServer.stop();
    } catch {
    }
    try {
      fileWatcher.stop();
    } catch {
    }
    try {
      ptyManager.kill();
    } catch {
    }
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
      }
    }
    process.stdin.pause();
    showCursor();
    leaveAlternateScreen();
  }
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", handleKeyInput);
  process.stdout.on("resize", () => {
    process.stdout.write("\x1B[2J");
    recalculateLayout();
    const contentCols2 = Math.max(1, layout.main.width - 2);
    const contentRows2 = Math.max(1, layout.main.height - 2);
    ptyManager.resize(contentCols2, contentRows2);
    renderFrame();
  });
  if (process.platform === "win32") {
    let lastCols = cols;
    let lastRows = rows;
    windowsPollId = setInterval(() => {
      const { cols: c, rows: r } = termSize();
      if (c !== lastCols || r !== lastRows) {
        lastCols = c;
        lastRows = r;
        recalculateLayout();
        const contentCols2 = Math.max(1, layout.main.width - 2);
        const contentRows2 = Math.max(1, layout.main.height - 2);
        ptyManager.resize(contentCols2, contentRows2);
      }
    }, WINDOWS_RESIZE_POLL_MS);
  }
  hookServer.onEvent((event) => {
    routeHookEvent(event);
  });
  fileWatcher.onChange((event) => {
    fileCount += 1;
    sessionCollector.recordFileChange(event.filePath, event.changeType);
    const opLabel = event.changeType === "A" ? fg.success + "+" : event.changeType === "D" ? fg.error + "-" : fg.main + "M";
    filesPane.appendLine(`${opLabel}\x1B[0m ${event.filePath}`);
  });
  try {
    fileWatcher.start(cwd);
  } catch {
  }
  ptyManager.onData((data) => {
    mainPane.write(data);
    const chunks = parser.feed(data);
    for (const chunk of chunks) {
      routeChunk(chunk);
    }
  });
  ptyManager.onExit((code) => {
    if (renderIntervalId !== null) clearInterval(renderIntervalId);
    mcpPane.appendLine(`${fg.textDim}Process exited (${code})\x1B[0m`);
    renderFrame();
    setTimeout(() => {
      cleanup();
      process.exit(code);
    }, 1500);
  });
  const memoryContext = projectMemory.buildContext();
  if (memoryContext.length > 0) {
    const contextFile = path5.join(projectMemory.memoryDir, "CONTEXT.md");
    try {
      fs4.mkdirSync(projectMemory.memoryDir, { recursive: true });
      fs4.writeFileSync(contextFile, `# Project Memory (auto-generated by Mission Control)

${memoryContext}
`, "utf8");
    } catch {
    }
  }
  const contentCols = Math.max(1, layout.main.width - 2);
  const contentRows = Math.max(1, layout.main.height - 2);
  ptyManager.spawn(contentCols, contentRows, cwd);
  renderFrame();
  renderIntervalId = setInterval(renderFrame, RENDER_INTERVAL_MS);
}
main().catch((err) => {
  leaveAlternateScreen();
  showCursor();
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
