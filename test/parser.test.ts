import { describe, it, expect, beforeEach } from 'vitest';
import { createParser } from '../src/parser.js';
import type { Parser } from '../src/parser.js';

describe('createParser', () => {
  let parser: Parser;

  beforeEach(() => {
    parser = createParser();
  });

  // --- Basic line classification ---

  it('returns empty array for empty string', () => {
    expect(parser.feed('')).toEqual([]);
  });

  it('buffers partial line until newline received', () => {
    expect(parser.feed('hello')).toEqual([]);
  });

  it('returns chunk once newline completes the line', () => {
    parser.feed('hello');
    const chunks = parser.feed('\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('main');
    expect(chunks[0]?.clean).toBe('hello');
  });

  it('classifies plain text as type main', () => {
    const chunks = parser.feed('just some output\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('main');
  });

  it('text field contains the raw text including ANSI codes', () => {
    const raw = '\x1b[32mgreen text\x1b[0m\n';
    const chunks = parser.feed(raw);
    expect(chunks[0]?.text).toBe('\x1b[32mgreen text\x1b[0m');
    expect(chunks[0]?.clean).toBe('green text');
  });

  it('produces multiple chunks for multiple lines in a single feed', () => {
    const chunks = parser.feed('line one\nline two\nline three\n');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.clean).toBe('line one');
    expect(chunks[1]?.clean).toBe('line two');
    expect(chunks[2]?.clean).toBe('line three');
  });

  // --- Thinking mode ---

  it('classifies "⚡ Thinking..." as type thinking', () => {
    const chunks = parser.feed('⚡ Thinking...\n');
    expect(chunks[0]?.type).toBe('thinking');
  });

  it('classifies "⚡ thinking..." lowercase as type thinking', () => {
    const chunks = parser.feed('⚡ thinking...\n');
    expect(chunks[0]?.type).toBe('thinking');
  });

  it('activates thinking mode so subsequent lines are also thinking', () => {
    parser.feed('⚡ Thinking...\n');
    const chunks = parser.feed('deep analysis here\n');
    expect(chunks[0]?.type).toBe('thinking');
  });

  it('maintains thinking mode across multiple subsequent lines', () => {
    parser.feed('⚡ Thinking...\n');
    const first = parser.feed('step one\n');
    const second = parser.feed('step two\n');
    expect(first[0]?.type).toBe('thinking');
    expect(second[0]?.type).toBe('thinking');
  });

  it('exits thinking mode when a tool use line is encountered', () => {
    parser.feed('⚡ Thinking...\n');
    parser.feed('some thinking\n');
    const chunks = parser.feed('Tool: Read\n');
    expect(chunks[0]?.type).toBe('mcp');
  });

  it('exits thinking mode when an agent spawn line is encountered', () => {
    parser.feed('⚡ Thinking...\n');
    const chunks = parser.feed('Spawned agent sub-agent-1\n');
    expect(chunks[0]?.type).toBe('agent');
  });

  it('classifies "extended thinking" as thinking via alt pattern', () => {
    const chunks = parser.feed('extended thinking mode activated\n');
    expect(chunks[0]?.type).toBe('thinking');
  });

  // --- Agent tracking ---

  it('classifies "Spawned agent sub-agent-1" as type agent', () => {
    const chunks = parser.feed('Spawned agent sub-agent-1\n');
    expect(chunks[0]?.type).toBe('agent');
  });

  it('includes agentId in spawn chunk', () => {
    const chunks = parser.feed('Spawned agent sub-agent-1\n');
    expect(chunks[0]?.agentId).toBe('agent-1');
  });

  it('includes agentName extracted from spawn line', () => {
    const chunks = parser.feed('Spawned agent sub-agent-1\n');
    expect(chunks[0]?.agentName).toBe('sub-agent-1');
  });

  it('extracts name from "Running agent: Architecture review"', () => {
    const chunks = parser.feed('Running agent: Architecture review\n');
    expect(chunks[0]?.type).toBe('agent');
    expect(chunks[0]?.agentName).toBe('Architecture review');
  });

  it('agent counter increments for each spawn', () => {
    const c1 = parser.feed('Spawned agent sub-agent-1\n');
    const c2 = parser.feed('Spawned agent sub-agent-2\n');
    expect(c1[0]?.agentId).toBe('agent-1');
    expect(c2[0]?.agentId).toBe('agent-2');
  });

  it('classifies "Agent completed" as type agent done marker', () => {
    parser.feed('Spawned agent sub-agent-1\n');
    const chunks = parser.feed('Agent completed\n');
    expect(chunks[0]?.type).toBe('agent');
    // agentId should reference the last known agent
    expect(chunks[0]?.agentId).toBeDefined();
  });

  it('classifies "agent done" pattern as type agent', () => {
    const chunks = parser.feed('sub-agent done\n');
    expect(chunks[0]?.type).toBe('agent');
  });

  it('classifies "Agent started" pattern as type agent', () => {
    const chunks = parser.feed('Agent Coder started\n');
    expect(chunks[0]?.type).toBe('agent');
    expect(chunks[0]?.agentName).toBe('Coder');
  });

  // --- Tool / MCP ---

  it('classifies "Tool: Read" as type mcp with toolName=Read', () => {
    const chunks = parser.feed('Tool: Read\n');
    expect(chunks[0]?.type).toBe('mcp');
    expect(chunks[0]?.toolName).toBe('Read');
  });

  it('classifies "Using: Bash" as type mcp with toolName=Bash', () => {
    const chunks = parser.feed('Using: Bash\n');
    expect(chunks[0]?.type).toBe('mcp');
    expect(chunks[0]?.toolName).toBe('Bash');
  });

  it('classifies "Calling: Write" as type mcp with toolName=Write', () => {
    const chunks = parser.feed('Calling: Write\n');
    expect(chunks[0]?.type).toBe('mcp');
    expect(chunks[0]?.toolName).toBe('Write');
  });

  it('classifies ⏳ Edit line as type mcp with toolName=Edit', () => {
    const chunks = parser.feed('⏳ Edit src/index.ts\n');
    expect(chunks[0]?.type).toBe('mcp');
    expect(chunks[0]?.toolName).toBe('Edit');
  });

  it('pending tool call has toolStatus pending', () => {
    const chunks = parser.feed('Tool: Read\n');
    expect(chunks[0]?.toolStatus).toBe('pending');
  });

  it('classifies "✓ Read (245 lines)" as mcp with status success', () => {
    const chunks = parser.feed('✓ Read.ts\n');
    expect(chunks[0]?.type).toBe('mcp');
    expect(chunks[0]?.toolStatus).toBe('success');
  });

  it('classifies "✗ Write failed" as mcp with status error', () => {
    const chunks = parser.feed('✗ Write failed\n');
    expect(chunks[0]?.type).toBe('mcp');
    expect(chunks[0]?.toolStatus).toBe('error');
  });

  // --- File operations ---

  it('classifies "Modified: src/index.ts" as type file with fileOp=M', () => {
    const chunks = parser.feed('Modified: src/index.ts\n');
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.fileOp).toBe('M');
    expect(chunks[0]?.filePath).toBe('src/index.ts');
  });

  it('classifies "Created: src/new.ts" as type file with fileOp=A', () => {
    const chunks = parser.feed('Created: src/new.ts\n');
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.fileOp).toBe('A');
    expect(chunks[0]?.filePath).toBe('src/new.ts');
  });

  it('classifies "Deleted: src/old.ts" as type file with fileOp=D', () => {
    const chunks = parser.feed('Deleted: src/old.ts\n');
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.fileOp).toBe('D');
    expect(chunks[0]?.filePath).toBe('src/old.ts');
  });

  it('classifies "Wrote: src/out.ts" as type file with fileOp=A', () => {
    const chunks = parser.feed('Wrote: src/out.ts\n');
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.fileOp).toBe('A');
  });

  it('classifies "Editing: src/foo.ts" as type file with fileOp=M', () => {
    const chunks = parser.feed('Editing: src/foo.ts\n');
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.fileOp).toBe('M');
  });

  it('classifies "Edited: src/bar.ts" as type file with fileOp=M', () => {
    const chunks = parser.feed('Edited: src/bar.ts\n');
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.fileOp).toBe('M');
  });

  // --- Error ---

  it('classifies "Error: something failed" as type error', () => {
    const chunks = parser.feed('Error: something failed\n');
    expect(chunks[0]?.type).toBe('error');
  });

  it('classifies lines starting with FAIL as type error', () => {
    const chunks = parser.feed('FAIL: test suite crashed\n');
    expect(chunks[0]?.type).toBe('error');
  });

  it('classifies "panic: runtime error" as type error', () => {
    const chunks = parser.feed('panic: runtime error\n');
    expect(chunks[0]?.type).toBe('error');
  });

  it('classifies "fatal: out of memory" as type error', () => {
    const chunks = parser.feed('fatal: out of memory\n');
    expect(chunks[0]?.type).toBe('error');
  });

  // --- ANSI codes in lines ---

  it('ANSI codes in lines do not break type classification', () => {
    const line = '\x1b[32mModified: src/index.ts\x1b[0m\n';
    const chunks = parser.feed(line);
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.filePath).toBe('src/index.ts');
  });

  it('ANSI codes in error lines do not break classification', () => {
    const line = '\x1b[31mError: something went wrong\x1b[0m\n';
    const chunks = parser.feed(line);
    expect(chunks[0]?.type).toBe('error');
  });

  // --- Partial line buffering ---

  it('buffers partial lines across multiple feeds until newline', () => {
    parser.feed('Mod');
    parser.feed('ified: ');
    const chunks = parser.feed('src/file.ts\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('file');
    expect(chunks[0]?.filePath).toBe('src/file.ts');
  });

  it('does not emit incomplete final line without trailing newline', () => {
    const chunks = parser.feed('line1\npartial');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.clean).toBe('line1');
  });

  it('emits buffered partial line when newline arrives later', () => {
    parser.feed('partial');
    const chunks = parser.feed('\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.clean).toBe('partial');
  });

  // --- State isolation across parsers ---

  it('separate parser instances have independent state', () => {
    const parser1 = createParser();
    const parser2 = createParser();
    parser1.feed('⚡ Thinking...\n');
    parser1.feed('thinking content\n');
    const chunks2 = parser2.feed('thinking content\n');
    // parser2 never saw thinking trigger, should be 'main'
    expect(chunks2[0]?.type).toBe('main');
  });

  it('agent counter starts at 0 and increments correctly', () => {
    const freshParser = createParser();
    const c1 = freshParser.feed('Spawned agent sub-agent-1\n');
    const c2 = freshParser.feed('Spawned agent sub-agent-2\n');
    const c3 = freshParser.feed('Spawned agent sub-agent-3\n');
    expect(c1[0]?.agentId).toBe('agent-1');
    expect(c2[0]?.agentId).toBe('agent-2');
    expect(c3[0]?.agentId).toBe('agent-3');
  });

  it('empty lines are classified as main', () => {
    const chunks = parser.feed('\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('main');
  });

  it('all chunks have text and clean fields', () => {
    const chunks = parser.feed('hello\nworld\n');
    for (const chunk of chunks) {
      expect(typeof chunk.text).toBe('string');
      expect(typeof chunk.clean).toBe('string');
    }
  });
});
