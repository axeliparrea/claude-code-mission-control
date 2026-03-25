/**
 * Shared types and constants for the Claude Mission Control rendering stack.
 * @module types
 */

/** Bold text attribute bitmask flag. */
export const ATTR_BOLD = 1;

/** Dim text attribute bitmask flag. */
export const ATTR_DIM = 2;

/** Italic text attribute bitmask flag. */
export const ATTR_ITALIC = 4;

/** Underline text attribute bitmask flag. */
export const ATTR_UNDERLINE = 8;

/** Inverse (reverse video) text attribute bitmask flag. */
export const ATTR_INVERSE = 16;

/**
 * Represents a single terminal cell with character data and styling.
 */
export interface Cell {
  /** The character to display in this cell. */
  char: string;
  /** ANSI SGR foreground color sequence, e.g. "\x1b[38;2;88;166;255m", or "" for default. */
  fg: string;
  /** ANSI SGR background color sequence, or "" for default. */
  bg: string;
  /** Bitmask of ATTR_* constants representing text attributes. */
  attrs: number;
}

/**
 * Represents a rectangular region on the terminal screen.
 */
export interface Rect {
  /** Left column (0-based). */
  left: number;
  /** Top row (0-based). */
  top: number;
  /** Width in columns. */
  width: number;
  /** Height in rows. */
  height: number;
}

/**
 * Layout state for the mission control UI.
 * - `solo`: Single fullscreen pane
 * - `single`: One main pane with sidebar
 * - `dual`: Two equal panes
 * - `compact`: Compact multi-pane layout
 */
export type LayoutState = 'solo' | 'single' | 'dual' | 'compact';

/**
 * Types of content chunks produced by the Claude Code output parser.
 */
export type ChunkType = 'main' | 'thinking' | 'agent' | 'mcp' | 'file' | 'error';

/**
 * A parsed chunk of Claude Code output with semantic metadata.
 */
export interface ParsedChunk {
  /** The semantic type of this chunk. */
  type: ChunkType;
  /** Raw text including ANSI escape sequences. */
  text: string;
  /** Plain text with ANSI sequences stripped. */
  clean: string;
  /** Identifier of the agent that produced this chunk (for agent chunks). */
  agentId?: string;
  /** Display name of the agent (for agent chunks). */
  agentName?: string;
  /** Name of the tool invoked (for mcp chunks). */
  toolName?: string;
  /** MCP server that owns the tool (for mcp chunks). */
  toolServer?: string;
  /** Current status of the tool call (for mcp chunks). */
  toolStatus?: 'pending' | 'success' | 'error';
  /** File path affected (for file chunks). */
  filePath?: string;
  /** File operation type (for file chunks). */
  fileOp?: 'M' | 'A' | 'D';
}

/**
 * Lifecycle status of a tracked sub-agent.
 */
export type AgentStatus = 'active' | 'done' | 'error' | 'queued';

/**
 * Runtime state for a tracked Claude Code sub-agent.
 */
export interface TrackedAgent {
  /** Unique identifier for this agent. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Current lifecycle status. */
  status: AgentStatus;
  /** Display slot index in the UI (optional). */
  slot?: number;
  /** Output lines accumulated from this agent. */
  lines: string[];
}

/**
 * Base interface for all renderable panes in the mission control UI.
 */
export interface PaneBase {
  /** Unique identifier for this pane. */
  id: string;
  /** Title displayed in the pane border. */
  title: string;
  /** Rectangular region this pane occupies on screen. */
  rect: Rect;
  /** ANSI color sequence for the pane border. */
  borderColor: string;
  /** Whether this pane has keyboard focus. */
  focused: boolean;
  /**
   * Renders this pane's content into the provided screen buffer.
   * @param screen - The screen buffer to render into
   */
  renderTo(screen: ScreenBuffer): void;
  /** Scroll the pane content up by one line. */
  scrollUp?(): void;
  /** Scroll the pane content down by one line. */
  scrollDown?(): void;
}

/**
 * A 2D cell grid with diff-based ANSI rendering to a terminal stream.
 */
export interface ScreenBuffer {
  /** Number of columns in the buffer. */
  cols: number;
  /** Number of rows in the buffer. */
  rows: number;
  /**
   * Sets a single cell at the given position.
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param char - Character to place in the cell
   * @param fg - Optional ANSI SGR foreground sequence
   * @param bg - Optional ANSI SGR background sequence
   * @param attrs - Optional attribute bitmask
   */
  put(row: number, col: number, char: string, fg?: string, bg?: string, attrs?: number): void;
  /**
   * Writes a plain string starting at the given position.
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param text - Plain text to write
   * @param fg - Optional ANSI SGR foreground sequence
   * @param bg - Optional ANSI SGR background sequence
   * @param attrs - Optional attribute bitmask
   * @returns Number of characters written
   */
  writeString(row: number, col: number, text: string, fg?: string, bg?: string, attrs?: number): number;
  /**
   * Draws a box border with Unicode box-drawing characters.
   * @param rect - The rectangle defining the box bounds
   * @param borderColor - ANSI SGR color sequence for the border
   * @param title - Optional title to render in the top border
   * @param titleColor - Optional ANSI SGR color for the title text
   * @param focused - Whether to render the border as focused (bright)
   */
  drawBox(rect: Rect, borderColor: string, title?: string, titleColor?: string, focused?: boolean): void;
  /**
   * Parses an ANSI-encoded string and writes cells up to maxWidth visible characters.
   * @param row - Row index (0-based)
   * @param col - Column index (0-based)
   * @param maxWidth - Maximum number of visible characters to write
   * @param text - ANSI-encoded text to parse and render
   * @returns Number of visible characters written
   */
  writeAnsiString(row: number, col: number, maxWidth: number, text: string): number;
  /** Clears the buffer, filling all cells with spaces and resetting styles. */
  clear(): void;
  /**
   * Flushes changed cells to the output stream using diff-based rendering.
   * @param stream - The writable stream to emit ANSI escape sequences to
   */
  flush(stream: NodeJS.WriteStream): void;
  /**
   * Resizes the buffer, recreating internal cell grids.
   * @param cols - New column count
   * @param rows - New row count
   */
  resize(cols: number, rows: number): void;
}
