/**
 * Classifies raw PTY output lines into semantic chunk types.
 * Buffers partial lines and applies ordered matchers to complete lines.
 * @module parser
 */

import type { ParsedChunk, ChunkType } from './types.js';

/**
 * A stateless or stateful matcher that attempts to classify a single line.
 * Returns a partial {@link ParsedChunk} on match, or null on no match.
 */
type MatchResult = Omit<ParsedChunk, 'text' | 'clean'> | null;

/**
 * The mutable state shared by all matchers during a parsing session.
 */
interface ParserState {
  thinkingActive: boolean;
  currentAgentId: string | null;
  agentCounter: number;
  lineBuffer: string;
}

/**
 * Attempts to match a thinking block opening line.
 */
const THINKING_ENTER_RE =
  /⚡\s*[Tt]hinking|\bthinking\b.*\.\.\.|\*\s*[Tt]wisting|\*\s*[Tt]hinking/i;

/**
 * Alternative thinking block opening patterns.
 * Matches Claude Code v2.x "thinking with X effort" format.
 */
const THINKING_ENTER_ALT_RE = /extended.?thinking|thinking with \w+ effort/i;

/**
 * Patterns that signal the end of a thinking block.
 */
const TOOL_OR_AGENT_RE =
  /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)|Running agent:|⊞\s*[Ss]pawn|Agent\s+\w+\s+started/i;

const AGENT_SPAWN_RE =
  /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)|Running agent:|⊞\s*[Ss]pawn|Agent\s+\w+\s+started/i;

const AGENT_DONE_RE =
  /(?:agent|sub[_-]?agent).*(?:done|complete|finished|returned)|Agent completed|✓.*agent/i;

const TOOL_USE_RE =
  /(?:Tool|Using|Calling):\s*(\S+)|tool_use\b|⏳.*(?:Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch)\b|^[LR]\s+\$\s+|●\s*(?:Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch|Recalling|Searching)/i;

const TOOL_RESULT_RE = /tool_result|✓\s*\w+\.\w+|✗\s*\w+|^Searched for \d+|^Read \d+ |^Wrote \d+ |^Edited \d+ /i;

const FILE_EDIT_RE =
  /(?:Modified|Created|Deleted|Wrote|Write to|Editing|Edited):\s*(.+)/i;

const ERROR_RE = /^Error:|✗|FAIL|panic:|fatal:|hook error$/i;

/**
 * Extracts an agent name from a spawn line using common patterns.
 * Returns a generic name if no specific name is found.
 */
function extractAgentName(line: string): string {
  const runningMatch = /Running agent:\s*(.+)/i.exec(line);
  if (runningMatch?.[1]) {
    return runningMatch[1].trim();
  }

  const spawnMatch = /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)\s+['""]?(\w[\w\s-]*?)['""]?(?:\s|$)/i.exec(line);
  if (spawnMatch?.[1]) {
    return spawnMatch[1].trim();
  }

  const startedMatch = /Agent\s+(\w+)\s+started/i.exec(line);
  if (startedMatch?.[1]) {
    return startedMatch[1].trim();
  }

  return 'Agent';
}

/**
 * Extracts the tool name from a tool-use line.
 */
function extractToolName(line: string): string {
  const colonMatch = /(?:Tool|Using|Calling):\s*(\S+)/i.exec(line);
  if (colonMatch?.[1]) {
    return colonMatch[1].trim();
  }

  const toolUseMatch = /⏳.*?(Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch)\b/.exec(line);
  if (toolUseMatch?.[1]) {
    return toolUseMatch[1].trim();
  }

  if (/^[LR]\s+\$\s+/.test(line)) {
    return 'Bash';
  }

  const dotMatch = /●\s*(Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch|Recalling|Searching)/i.exec(line);
  if (dotMatch?.[1]) {
    return dotMatch[1].trim();
  }

  const resultMatch = /^(Searched|Read|Wrote|Edited)\b/i.exec(line);
  if (resultMatch?.[1]) {
    return resultMatch[1].trim();
  }

  return 'tool';
}

/**
 * Extracts the file path from a file-edit line.
 */
function extractFilePath(line: string): string {
  const match = /(?:Modified|Created|Deleted|Wrote|Write to|Editing|Edited):\s*(.+)/i.exec(line);
  return match?.[1]?.trim() ?? '';
}

/**
 * Determines the file operation type from a file-edit line.
 */
function extractFileOp(line: string): 'M' | 'A' | 'D' {
  if (/(?:Deleted)/i.test(line)) return 'D';
  if (/(?:Created|Wrote|Write to)/i.test(line)) return 'A';
  return 'M';
}

/**
 * Determines whether a line should exit the thinking block.
 * Exits on tool/agent lines or clearly non-thinking content.
 */
function shouldExitThinking(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (TOOL_OR_AGENT_RE.test(trimmed)) return true;
  if (TOOL_USE_RE.test(trimmed)) return true;
  if (FILE_EDIT_RE.test(trimmed)) return true;
  if (/^[●>]\s/.test(trimmed)) return true;
  return false;
}

/**
 * Classifies a single complete line given the current parser state.
 * Mutates state for stateful matchers (thinking, agent tracking).
 */
function classifyLine(line: string, state: ParserState): ParsedChunk {
  const clean = line.replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b[^[\]]/g, '');

  if (state.thinkingActive) {
    if (shouldExitThinking(line)) {
      state.thinkingActive = false;
    } else {
      return { type: 'thinking', text: line, clean };
    }
  }

  if (THINKING_ENTER_RE.test(clean) || THINKING_ENTER_ALT_RE.test(clean)) {
    state.thinkingActive = true;
    return { type: 'thinking', text: line, clean };
  }

  if (AGENT_SPAWN_RE.test(clean)) {
    state.agentCounter += 1;
    const agentId = `agent-${state.agentCounter}`;
    const agentName = extractAgentName(clean);
    state.currentAgentId = agentId;
    return { type: 'agent', text: line, clean, agentId, agentName };
  }

  if (AGENT_DONE_RE.test(clean)) {
    const agentId = state.currentAgentId ?? `agent-${state.agentCounter}`;
    return { type: 'agent', text: line, clean, agentId };
  }

  if (TOOL_USE_RE.test(clean)) {
    const toolName = extractToolName(clean);
    return { type: 'mcp', text: line, clean, toolName, toolStatus: 'pending' };
  }

  if (TOOL_RESULT_RE.test(clean)) {
    const isError = /✗/.test(clean);
    return {
      type: 'mcp',
      text: line,
      clean,
      toolStatus: isError ? 'error' : 'success',
    };
  }

  if (FILE_EDIT_RE.test(clean)) {
    const filePath = extractFilePath(clean);
    const fileOp = extractFileOp(clean);
    return { type: 'file', text: line, clean, filePath, fileOp };
  }

  if (ERROR_RE.test(clean)) {
    return { type: 'error', text: line, clean };
  }

  return { type: 'main', text: line, clean };
}

/**
 * Feeds buffered raw data through line splitting and classification,
 * returning an array of parsed chunks for complete lines only.
 */
function feedData(raw: string, state: ParserState): ParsedChunk[] {
  const combined = state.lineBuffer + raw;
  const newlineIndex = combined.lastIndexOf('\n');

  if (newlineIndex === -1) {
    state.lineBuffer = combined;
    return [];
  }

  const complete = combined.slice(0, newlineIndex);
  state.lineBuffer = combined.slice(newlineIndex + 1);

  const lines = complete.split('\n');
  const chunks: ParsedChunk[] = [];

  for (const line of lines) {
    chunks.push(classifyLine(line, state));
  }

  return chunks;
}

/**
 * A stateful parser that classifies PTY output into semantic chunks.
 */
export interface Parser {
  /**
   * Feeds raw PTY data into the parser.
   * Lines are buffered until a newline is received, then classified.
   * @param raw - Raw PTY output data, potentially containing partial lines
   * @returns Array of {@link ParsedChunk} objects for all complete lines
   */
  feed(raw: string): ParsedChunk[];
}

/**
 * Creates a new {@link Parser} with fresh internal state.
 *
 * @returns A ready-to-use Parser instance
 */
export function createParser(): Parser {
  const state: ParserState = {
    thinkingActive: false,
    currentAgentId: null,
    agentCounter: 0,
    lineBuffer: '',
  };

  return {
    feed(raw: string): ParsedChunk[] {
      return feedData(raw, state);
    },
  };
}
