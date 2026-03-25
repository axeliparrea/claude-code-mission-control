/**
 * Color palette and ANSI true-color helpers for Claude Mission Control.
 * @module theme
 */

/**
 * Converts a hex color string to an ANSI SGR true-color foreground sequence.
 * @param hex - A hex color string in the format "#rrggbb"
 * @returns An ANSI escape sequence setting the foreground to the given RGB color
 */
export function hexToFg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Converts a hex color string to an ANSI SGR true-color background sequence.
 * @param hex - A hex color string in the format "#rrggbb"
 * @returns An ANSI escape sequence setting the background to the given RGB color
 */
export function hexToBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `\x1b[48;2;${r};${g};${b}m`;
}

const palette = {
  bg: '#0d1117',
  headerBg: '#161b22',
  borderDefault: '#21262d',
  textPrimary: '#c9d1d9',
  textSecondary: '#8b949e',
  textDim: '#484f58',
  main: '#58a6ff',
  agent: '#bc8cff',
  thinking: '#f0c050',
  mcp: '#5dca7a',
  files: '#f06080',
  error: '#f85149',
  success: '#5dca7a',
  warning: '#f0c050',
} as const;

/**
 * Pre-computed ANSI foreground sequences for each palette color.
 */
export const fg: Record<keyof typeof palette, string> = {
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
  warning: hexToFg(palette.warning),
};

/**
 * Pre-computed ANSI background sequences for each palette color.
 */
export const bg: Record<keyof typeof palette, string> = {
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
  warning: hexToBg(palette.warning),
};

/**
 * Unicode icons used throughout the mission control UI.
 */
export const icons = {
  success: '✓',
  error: '✗',
  pending: '⟳',
  dot: '●',
  arrow: '→',
  spawn: '⊞',
} as const;
