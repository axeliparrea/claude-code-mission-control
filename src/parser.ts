/**
 * Classifies raw PTY output lines into semantic chunk types.
 * Buffers partial lines and applies ordered matchers to complete lines.
 * @module parser
 */

import type { ParsedChunk, ChunkType } from './types.js';

type MatchResult = Omit<ParsedChunk, 'text' | 'clean'> | null;

interface ParserState {
  currentAgentId: string | null;
  agentCounter: number;
  lineBuffer: string;
}

/**
 * Thinking line patterns — each line is matched independently (NOT stateful).
 * Claude Code v2.x uses: "* Thinking...", "* Bootstrapping... (thinking with X effort)",
 * "* Cogitated for Ns", "⚡ Thinking", "· Thinking..."
 */
const THINKING_LINE_RE =
  /^\s*[*·]\s*(thinking|twisting|bootstrapping|cogitat)/i;

const THINKING_EFFORT_RE =
  /thinking with \w+ effort/i;

const THINKING_DURATION_RE =
  /cogitated for \d+/i;

const AGENT_SPAWN_RE =
  /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)|Running agent:|⊞\s*[Ss]pawn|Agent\s+\w+\s+started|Launched? (?:a |new )?(?:agent|sub[_-]?agent)/i;

const AGENT_DONE_RE =
  /(?:agent|sub[_-]?agent).*(?:done|complete|finished|returned)|Agent completed|✓.*agent/i;

const TOOL_USE_RE =
  /(?:Tool|Using|Calling):\s*(\S+)|⏳.*(?:Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch)\b|●\s*(?:Searching|Recalling|Reading|Writing|Editing)/i;

const TOOL_RESULT_RE =
  /^Searched for \d+|^Read \d+ |^Wrote \d+ |^Edited \d+ |✓\s*\w+\.\w+|✗\s*\w+/i;

const BASH_CMD_RE =
  /^\s*[LR]\s+\$\s+/;

const FILE_EDIT_RE =
  /(?:Modified|Created|Deleted|Wrote|Write to|Editing|Edited):\s*(.+)/i;

const ERROR_RE =
  /^Error:|✗|FAIL(?:ED)?|panic:|fatal:|hook error$/i;

/**
 * Lines that should NEVER go to side panels — they're Claude Code UI chrome.
 * Status bar, permission prompts, context indicators, etc.
 */
const UI_CHROME_RE =
  /^\s*>>|bypasspermission|shift\+tab|Context\s+\d+%|Usage\s+\d+%|resets?\s+in\s+\d+|^\s*\[Sonnet|^\s*\[Opus|^\s*\[Haiku|^\s*\[Claude|ctrl\+o to expand|\(shift\+tab/i;

function extractAgentName(line: string): string {
  const runningMatch = /Running agent:\s*(.+)/i.exec(line);
  if (runningMatch?.[1]) return runningMatch[1].trim();

  const spawnMatch = /[Ss]pawn(?:ed|ing)?\s+(?:agent|sub[_-]?agent)\s+['""]?(\w[\w\s-]*?)['""]?(?:\s|$)/i.exec(line);
  if (spawnMatch?.[1]) return spawnMatch[1].trim();

  const startedMatch = /Agent\s+(\w+)\s+started/i.exec(line);
  if (startedMatch?.[1]) return startedMatch[1].trim();

  return 'Agent';
}

function extractToolName(line: string): string {
  const colonMatch = /(?:Tool|Using|Calling):\s*(\S+)/i.exec(line);
  if (colonMatch?.[1]) return colonMatch[1].trim();

  const emojiMatch = /⏳.*?(Read|Write|Edit|Bash|Glob|Grep|Agent|WebSearch|WebFetch)\b/.exec(line);
  if (emojiMatch?.[1]) return emojiMatch[1].trim();

  const dotMatch = /●\s*(Searching|Recalling|Reading|Writing|Editing)/i.exec(line);
  if (dotMatch?.[1]) return dotMatch[1].trim();

  if (BASH_CMD_RE.test(line)) return 'Bash';

  const resultMatch = /^(Searched|Read|Wrote|Edited)\b/i.exec(line);
  if (resultMatch?.[1]) return resultMatch[1].trim();

  return 'tool';
}

function extractFilePath(line: string): string {
  const match = /(?:Modified|Created|Deleted|Wrote|Write to|Editing|Edited):\s*(.+)/i.exec(line);
  return match?.[1]?.trim() ?? '';
}

function extractFileOp(line: string): 'M' | 'A' | 'D' {
  if (/(?:Deleted)/i.test(line)) return 'D';
  if (/(?:Created|Wrote|Write to)/i.test(line)) return 'A';
  return 'M';
}

/**
 * Classifies a single line. NO stateful thinking tracking — each line
 * is classified independently to avoid capturing Claude Code UI chrome.
 */
function classifyLine(line: string, state: ParserState): ParsedChunk {
  const clean = line
    .replace(/\x1b\[[0-9;]*[mGKHFABCDJsu]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b\[\?[0-9;]*[hl]/g, '')
    .replace(/\x1b[^[\]]/g, '')
    .replace(/\x07/g, '');

  if (UI_CHROME_RE.test(clean)) {
    return { type: 'main', text: line, clean };
  }

  if (THINKING_LINE_RE.test(clean) || THINKING_EFFORT_RE.test(clean) || THINKING_DURATION_RE.test(clean)) {
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

  if (TOOL_USE_RE.test(clean) || BASH_CMD_RE.test(clean)) {
    const toolName = extractToolName(clean);
    return { type: 'mcp', text: line, clean, toolName, toolStatus: 'pending' };
  }

  if (TOOL_RESULT_RE.test(clean)) {
    const isError = /✗/.test(clean);
    return { type: 'mcp', text: line, clean, toolStatus: isError ? 'error' : 'success' };
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
   * @param raw - Raw PTY output data, potentially containing partial lines
   * @returns Array of {@link ParsedChunk} objects for all complete lines
   */
  feed(raw: string): ParsedChunk[];
}

/**
 * Creates a new {@link Parser} with fresh internal state.
 */
export function createParser(): Parser {
  const state: ParserState = {
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
