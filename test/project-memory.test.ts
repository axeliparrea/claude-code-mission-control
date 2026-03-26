import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createProjectMemory } from '../src/memory/project-memory.js';
import { createSessionCollector } from '../src/memory/session-collector.js';
import type { ProjectMemory } from '../src/memory/project-memory.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-memory-test-'));
}

describe('ProjectMemory', () => {
  let tmpDir: string;
  let memory: ProjectMemory;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    memory = createProjectMemory(tmpDir);
    memory.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .mc/memory/ directory on load', () => {
    expect(fs.existsSync(path.join(tmpDir, '.mc', 'memory'))).toBe(true);
  });

  it('saves and retrieves a memory entry', () => {
    const entry = memory.save({
      type: 'architecture',
      title: 'Uses event bus pattern',
      content: 'The app uses a central event bus for component communication',
      tags: ['architecture', 'events'],
      relevance: 5,
    });

    expect(entry.id).toBeDefined();
    expect(entry.createdAt).toBeGreaterThan(0);

    const all = memory.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe('Uses event bus pattern');
  });

  it('persists entries to disk and reloads', () => {
    memory.save({
      type: 'decision',
      title: 'Use TypeScript strict',
      content: 'Strict mode enabled for type safety',
      tags: ['typescript'],
      relevance: 3,
    });

    const memory2 = createProjectMemory(tmpDir);
    memory2.load();

    const entries = memory2.getAll();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.title).toBe('Use TypeScript strict');
  });

  it('updates an entry', () => {
    const entry = memory.save({
      type: 'pattern',
      title: 'Factory functions',
      content: 'Uses factory pattern',
      tags: ['patterns'],
      relevance: 2,
    });

    memory.update(entry.id, { content: 'Uses factory pattern for all modules', relevance: 5 });

    const updated = memory.getAll()[0];
    expect(updated!.content).toBe('Uses factory pattern for all modules');
    expect(updated!.relevance).toBe(5);
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(updated!.createdAt);
  });

  it('searches by keyword', () => {
    memory.save({ type: 'architecture', title: 'Event bus', content: 'Central event bus', tags: ['events'], relevance: 3 });
    memory.save({ type: 'pattern', title: 'Factory functions', content: 'Creates instances via factory', tags: ['factory'], relevance: 2 });
    memory.save({ type: 'decision', title: 'No blessed', content: 'Dropped blessed for raw ANSI', tags: ['tui'], relevance: 5 });

    const results = memory.search('event bus');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.title).toBe('Event bus');
  });

  it('filters by type', () => {
    memory.save({ type: 'architecture', title: 'A1', content: 'arch1', tags: [], relevance: 1 });
    memory.save({ type: 'decision', title: 'D1', content: 'dec1', tags: [], relevance: 1 });
    memory.save({ type: 'architecture', title: 'A2', content: 'arch2', tags: [], relevance: 1 });

    const arch = memory.getByType('architecture');
    expect(arch).toHaveLength(2);
  });

  it('saves and retrieves session summaries', () => {
    memory.saveSession({
      startedAt: Date.now() - 60000,
      endedAt: Date.now(),
      agentsUsed: 2,
      toolCalls: 15,
      filesChanged: ['src/index.ts', 'src/parser.ts'],
      thinkingTopics: ['analyzing code', 'finding bugs'],
      summary: '15 tool calls; agents: Explore, coder; 2 files changed',
    });

    const sessions = memory.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.agentsUsed).toBe(2);
    expect(sessions[0]!.toolCalls).toBe(15);
  });

  it('builds context string with sessions and entries', () => {
    memory.save({ type: 'architecture', title: 'Modular', content: 'Modular architecture with plugins', tags: [], relevance: 3 });
    memory.saveSession({
      startedAt: Date.now() - 60000,
      endedAt: Date.now(),
      agentsUsed: 1,
      toolCalls: 5,
      filesChanged: ['src/index.ts'],
      thinkingTopics: [],
      summary: 'Quick fix session',
    });

    const context = memory.buildContext();
    expect(context).toContain('Recent Sessions');
    expect(context).toContain('Quick fix session');
    expect(context).toContain('Architecture');
    expect(context).toContain('Modular');
  });

  it('tracks important files', () => {
    memory.trackFile('src/index.ts', 'Modified during refactor');
    memory.trackFile('src/parser.ts', 'Created new parser');

    const context = memory.buildContext();
    expect(context).toContain('src/index.ts');
    expect(context).toContain('src/parser.ts');
  });
});

describe('SessionCollector', () => {
  let tmpDir: string;
  let memory: ProjectMemory;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    memory = createProjectMemory(tmpDir);
    memory.load();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collects tool calls and saves session on finalize', () => {
    const collector = createSessionCollector(memory);

    collector.recordHookEvent({ type: 'tool_start', toolName: 'Read', timestamp: Date.now() });
    collector.recordHookEvent({ type: 'tool_start', toolName: 'Edit', timestamp: Date.now() });
    collector.recordHookEvent({ type: 'agent_spawn', agentType: 'Explore', timestamp: Date.now() });

    collector.recordChunk({ type: 'file', text: '', clean: '', filePath: 'src/app.ts', fileOp: 'M' });
    collector.recordFileChange('src/new.ts', 'A');

    expect(collector.stats.toolCalls).toBe(2);
    expect(collector.stats.agentsUsed).toBe(1);
    expect(collector.stats.filesChanged).toBe(2);

    collector.finalize();

    const sessions = memory.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.toolCalls).toBe(2);
    expect(sessions[0]!.agentsUsed).toBe(1);
  });
});
