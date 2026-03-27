/**
 * Persistence tests — verifies that project memory survives across sessions.
 * Simulates multiple MC sessions saving and loading from the same project.
 * @module test/persistence
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createProjectMemory } from '../src/memory/project-memory.js';
import { createSessionCollector } from '../src/memory/session-collector.js';

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-persist-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"test-project"}');
  return dir;
}

describe('Memory persistence across sessions', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeTmpProject();
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('session 1 data is available in session 2', () => {
    const mem1 = createProjectMemory(projectDir);
    mem1.load();

    mem1.save({
      type: 'architecture',
      title: 'Event-driven architecture',
      content: 'Uses EventBus for decoupled communication',
      tags: ['architecture', 'events'],
      relevance: 5,
    });

    mem1.save({
      type: 'decision',
      title: 'TypeScript strict mode',
      content: 'Enabled strict for type safety',
      tags: ['typescript'],
      relevance: 3,
    });

    mem1.trackFile('src/event-bus.ts', 'Core module');

    const collector1 = createSessionCollector(mem1);
    collector1.recordHookEvent({ type: 'tool_start', toolName: 'Read', timestamp: Date.now() });
    collector1.recordHookEvent({ type: 'tool_start', toolName: 'Edit', timestamp: Date.now() });
    collector1.recordHookEvent({ type: 'agent_spawn', agentType: 'Explore', timestamp: Date.now() });
    collector1.recordFileChange('src/index.ts', 'M');
    collector1.finalize();

    const mem2 = createProjectMemory(projectDir);
    mem2.load();

    const allEntries = mem2.getAll();
    expect(allEntries.length).toBeGreaterThanOrEqual(2);
    const titles = allEntries.map((e) => e.title);
    expect(titles).toContain('Event-driven architecture');
    expect(titles).toContain('TypeScript strict mode');

    const sessions = mem2.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.toolCalls).toBe(2);
    expect(sessions[0]!.agentsUsed).toBe(1);

    const context = mem2.buildContext();
    expect(context).toContain('Event-driven');
    expect(context).toContain('TypeScript strict');
    expect(context).toContain('src/event-bus.ts');
  });

  it('multiple sessions accumulate data', () => {
    for (let i = 1; i <= 3; i++) {
      const mem = createProjectMemory(projectDir);
      mem.load();

      mem.save({
        type: 'pattern',
        title: `Pattern from session ${i}`,
        content: `Discovered in session ${i}`,
        tags: [`session-${i}`],
        relevance: i,
      });

      const collector = createSessionCollector(mem);
      for (let j = 0; j < i * 5; j++) {
        collector.recordHookEvent({ type: 'tool_start', toolName: 'Read', timestamp: Date.now() });
      }
      collector.finalize();
    }

    const memFinal = createProjectMemory(projectDir);
    memFinal.load();

    expect(memFinal.getAll()).toHaveLength(3);
    expect(memFinal.getSessions()).toHaveLength(3);

    const sessions = memFinal.getSessions();
    const toolCallCounts = sessions.map((s) => s.toolCalls).sort((a, b) => a - b);
    expect(toolCallCounts).toEqual([5, 10, 15]);
  });

  it('context string includes data from all sessions', () => {
    const mem1 = createProjectMemory(projectDir);
    mem1.load();
    mem1.save({ type: 'architecture', title: 'Modular design', content: 'Plugin-based', tags: [], relevance: 5 });
    mem1.save({ type: 'decision', title: 'No ORM', content: 'Raw SQL for performance', tags: [], relevance: 4 });
    const c1 = createSessionCollector(mem1);
    c1.recordHookEvent({ type: 'tool_start', toolName: 'Bash', timestamp: Date.now() });
    c1.finalize();

    const mem2 = createProjectMemory(projectDir);
    mem2.load();
    mem2.save({ type: 'pattern', title: 'Factory pattern', content: 'All modules use factories', tags: [], relevance: 3 });
    mem2.trackFile('src/factory.ts', 'Core pattern');
    const c2 = createSessionCollector(mem2);
    c2.recordHookEvent({ type: 'agent_spawn', agentType: 'coder', timestamp: Date.now() });
    c2.finalize();

    const memRead = createProjectMemory(projectDir);
    memRead.load();
    const context = memRead.buildContext();

    expect(context).toContain('Modular design');
    expect(context).toContain('No ORM');
    expect(context).toContain('Factory pattern');
    expect(context).toContain('src/factory.ts');
    expect(context).toContain('Recent Sessions');
  });

  it('CONTEXT.md file is written and readable', () => {
    const mem = createProjectMemory(projectDir);
    mem.load();
    mem.save({ type: 'architecture', title: 'Test arch', content: 'Test content', tags: [], relevance: 5 });

    const collector = createSessionCollector(mem);
    collector.recordHookEvent({ type: 'tool_start', toolName: 'Read', timestamp: Date.now() });
    collector.finalize();

    const context = mem.buildContext();
    const contextFile = path.join(mem.memoryDir, 'CONTEXT.md');
    fs.mkdirSync(mem.memoryDir, { recursive: true });
    fs.writeFileSync(contextFile, `# Project Memory\n\n${context}\n`, 'utf8');

    expect(fs.existsSync(contextFile)).toBe(true);
    const content = fs.readFileSync(contextFile, 'utf8');
    expect(content).toContain('Test arch');
    expect(content).toContain('Recent Sessions');
  });

  it('.mc directory structure is correct', () => {
    const mem = createProjectMemory(projectDir);
    mem.load();
    mem.save({ type: 'decision', title: 'Test', content: 'Test', tags: [], relevance: 1 });

    const collector = createSessionCollector(mem);
    collector.finalize();

    expect(fs.existsSync(path.join(projectDir, '.mc'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.mc', 'memory'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.mc', 'sessions'))).toBe(true);
    expect(fs.existsSync(path.join(projectDir, '.mc', 'memory', 'entries.json'))).toBe(true);

    const sessionFiles = fs.readdirSync(path.join(projectDir, '.mc', 'sessions'));
    expect(sessionFiles.length).toBe(1);
    expect(sessionFiles[0]).toMatch(/\.json$/);
  });

  it('search finds entries from previous sessions', () => {
    const mem1 = createProjectMemory(projectDir);
    mem1.load();
    mem1.save({ type: 'architecture', title: 'WebSocket real-time', content: 'Uses WS for live updates', tags: ['websocket', 'realtime'], relevance: 5 });
    mem1.save({ type: 'pattern', title: 'Repository pattern', content: 'Data access via repos', tags: ['data', 'pattern'], relevance: 3 });

    const mem2 = createProjectMemory(projectDir);
    mem2.load();

    const wsResults = mem2.search('websocket real-time');
    expect(wsResults.length).toBeGreaterThan(0);
    expect(wsResults[0]!.title).toBe('WebSocket real-time');

    const repoResults = mem2.search('repository data access');
    expect(repoResults.length).toBeGreaterThan(0);
    expect(repoResults[0]!.title).toBe('Repository pattern');
  });
});
