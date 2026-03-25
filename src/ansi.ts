/**
 * ANSI escape sequence parser for the Claude Mission Control rendering stack.
 * Converts ANSI-encoded strings into styled cell arrays for rendering.
 * @module ansi
 */

import { ATTR_BOLD, ATTR_DIM, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_INVERSE } from './types.js';

/** Regex matching any ANSI escape sequence. */
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Removes all ANSI escape sequences from a string, returning plain text.
 * @param text - Input string potentially containing ANSI escape sequences
 * @returns The input string with all ANSI sequences removed
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '');
}

/** Standard ANSI foreground colors indexed by color number (0-7). */
const STANDARD_FG = [
  '\x1b[30m', '\x1b[31m', '\x1b[32m', '\x1b[33m',
  '\x1b[34m', '\x1b[35m', '\x1b[36m', '\x1b[37m',
];

/** Bright ANSI foreground colors indexed by color number (0-7). */
const BRIGHT_FG = [
  '\x1b[90m', '\x1b[91m', '\x1b[92m', '\x1b[93m',
  '\x1b[94m', '\x1b[95m', '\x1b[96m', '\x1b[97m',
];

/** Standard ANSI background colors indexed by color number (0-7). */
const STANDARD_BG = [
  '\x1b[40m', '\x1b[41m', '\x1b[42m', '\x1b[43m',
  '\x1b[44m', '\x1b[45m', '\x1b[46m', '\x1b[47m',
];

/** Bright ANSI background colors indexed by color number (0-7). */
const BRIGHT_BG = [
  '\x1b[100m', '\x1b[101m', '\x1b[102m', '\x1b[103m',
  '\x1b[104m', '\x1b[105m', '\x1b[106m', '\x1b[107m',
];

interface StyleState {
  fg: string;
  bg: string;
  attrs: number;
}

/**
 * Parsed cell produced by the ANSI parser.
 */
export interface AnsiCell {
  /** The character for this cell. */
  char: string;
  /** ANSI SGR foreground sequence, or "" for default. */
  fg: string;
  /** ANSI SGR background sequence, or "" for default. */
  bg: string;
  /** Attribute bitmask using ATTR_* constants. */
  attrs: number;
}

function applyCode(codes: number[], idx: number, state: StyleState): number {
  const code = codes[idx] ?? 0;

  if (code === 0) {
    state.fg = '';
    state.bg = '';
    state.attrs = 0;
    return idx + 1;
  }

  if (code === 1) { state.attrs |= ATTR_BOLD; return idx + 1; }
  if (code === 2) { state.attrs |= ATTR_DIM; return idx + 1; }
  if (code === 3) { state.attrs |= ATTR_ITALIC; return idx + 1; }
  if (code === 4) { state.attrs |= ATTR_UNDERLINE; return idx + 1; }
  if (code === 7) { state.attrs |= ATTR_INVERSE; return idx + 1; }
  if (code === 22) { state.attrs &= ~(ATTR_BOLD | ATTR_DIM); return idx + 1; }
  if (code === 23) { state.attrs &= ~ATTR_ITALIC; return idx + 1; }
  if (code === 24) { state.attrs &= ~ATTR_UNDERLINE; return idx + 1; }
  if (code === 27) { state.attrs &= ~ATTR_INVERSE; return idx + 1; }
  if (code === 39) { state.fg = ''; return idx + 1; }
  if (code === 49) { state.bg = ''; return idx + 1; }

  if (code >= 30 && code <= 37) {
    state.fg = STANDARD_FG[code - 30] ?? '';
    return idx + 1;
  }
  if (code >= 40 && code <= 47) {
    state.bg = STANDARD_BG[code - 40] ?? '';
    return idx + 1;
  }
  if (code >= 90 && code <= 97) {
    state.fg = BRIGHT_FG[code - 90] ?? '';
    return idx + 1;
  }
  if (code >= 100 && code <= 107) {
    state.bg = BRIGHT_BG[code - 100] ?? '';
    return idx + 1;
  }

  if (code === 38) {
    const mode = codes[idx + 1];
    if (mode === 5) {
      const n = codes[idx + 2] ?? 0;
      state.fg = `\x1b[38;5;${n}m`;
      return idx + 3;
    }
    if (mode === 2) {
      const r = codes[idx + 2] ?? 0;
      const g = codes[idx + 3] ?? 0;
      const b = codes[idx + 4] ?? 0;
      state.fg = `\x1b[38;2;${r};${g};${b}m`;
      return idx + 5;
    }
  }

  if (code === 48) {
    const mode = codes[idx + 1];
    if (mode === 5) {
      const n = codes[idx + 2] ?? 0;
      state.bg = `\x1b[48;5;${n}m`;
      return idx + 3;
    }
    if (mode === 2) {
      const r = codes[idx + 2] ?? 0;
      const g = codes[idx + 3] ?? 0;
      const b = codes[idx + 4] ?? 0;
      state.bg = `\x1b[48;2;${r};${g};${b}m`;
      return idx + 5;
    }
  }

  return idx + 1;
}

function parseSgrSequence(seq: string, state: StyleState): void {
  const inner = seq.slice(2, -1);
  if (inner === '') {
    state.fg = '';
    state.bg = '';
    state.attrs = 0;
    return;
  }
  const codes = inner.split(';').map(Number);
  let i = 0;
  while (i < codes.length) {
    i = applyCode(codes, i, state);
  }
}

/**
 * Parses an ANSI-encoded string into an array of styled cells.
 *
 * Walks the string character by character, tracking SGR style state.
 * Each printable character produces one cell with the current fg, bg, and attrs.
 * Handles the full standard SGR subset including 256-color and RGB true-color.
 *
 * @param text - An ANSI-encoded string to parse
 * @returns An array of cells, one per printable character
 */
export function parseAnsiToCells(text: string): AnsiCell[] {
  const cells: AnsiCell[] = [];
  const state: StyleState = { fg: '', bg: '', attrs: 0 };
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      const end = text.indexOf('m', i + 2);
      if (end !== -1) {
        const seq = text.slice(i, end + 1);
        parseSgrSequence(seq, state);
        i = end + 1;
        continue;
      }
    }

    const ch = text[i];
    if (ch !== undefined && ch >= ' ') {
      cells.push({ char: ch, fg: state.fg, bg: state.bg, attrs: state.attrs });
    }
    i++;
  }

  return cells;
}
