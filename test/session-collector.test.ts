/**
 * Comprehensive tests for SessionCollector — verifies session summaries,
 * agent report cards, error lessons, and auto-detection.
 * @module test/session-collector
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createProjectMemory } from '../src/memory/project-memory.js';
import { createSessionCollector } from '../src/memory/session-collector.js';
import type { ProjectMemory } from '../src/memory/project-memory.js';
import type { SessionCollector } from '../src/memory/session-collector.js';
import type { HookEvent } from '../src/hooks/hook-server.js';
import type { ParsedChunk } from '../src/types.js';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-collector-test-'));
}

function makeChunk(overrides: Partial<ParsedChunk>): ParsedChunk {
  return { type: 'main', text: '', clean: '', ...overrides };
}

function makeHookEvent(overrides: Partial<HookEvent>): HookEvent {
  return { type: 'tool_start', timestamp: Date.now(), ...overrides } as HookEvent;
}

describe('SessionCollector', () => {
  let tmpDir: string;
  let memory: ProjectMemory;
  let collector: SessionCollector;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    memory = createProjectMemory(tmpDir);
    memory.load();
    collector = createSessionCollector(memory);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Basic stats tracking', () => {
    it('starts with zero stats', () => {
      expect(collector.stats.toolCalls).toBe(0);
      expect(collector.stats.agentsUsed).toBe(0);
      expect(collector.stats.filesChanged).toBe(0);
      expect(collector.stats.errors).toBe(0);
    });

    it('counts tool calls from hook events', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Read' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Edit' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Bash' }));
      expect(collector.stats.toolCalls).toBe(3);
    });

    it('counts tool calls from parsed chunks', () => {
      collector.recordChunk(makeChunk({ type: 'mcp', toolName: 'Read' }));
      collector.recordChunk(makeChunk({ type: 'mcp', toolName: 'Glob' }));
      expect(collector.stats.toolCalls).toBe(2);
    });

    it('counts unique files changed', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/a.ts', fileOp: 'M' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/b.ts', fileOp: 'A' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/a.ts', fileOp: 'M' }));
      expect(collector.stats.filesChanged).toBe(2);
    });

    it('counts errors', () => {
      collector.recordChunk(makeChunk({ type: 'error', clean: 'Error: something broke' }));
      collector.recordChunk(makeChunk({ type: 'error', clean: 'FAIL: test failed' }));
      expect(collector.stats.errors).toBe(2);
    });

    it('tracks duration', () => {
      expect(collector.stats.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Agent report cards', () => {
    it('tracks agent spawn from hook events', () => {
      collector.recordHookEvent(makeHookEvent({
        type: 'agent_spawn',
        agentType: 'Explore',
        agentPrompt: 'Find all API endpoints',
      }));
      expect(collector.stats.agentsUsed).toBe(1);
    });

    it('tracks multiple agents', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'coder11111' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));
      expect(collector.stats.agentsUsed).toBe(2);
    });

    it('tracks agent tool counts', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Read' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_end', toolName: 'Read', toolSuccess: true }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Glob' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_end', toolName: 'Glob', toolSuccess: true }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('#1 Explore [OK] (2 tools)');
    });

    it('marks failed agents', () => {
      collector.recordHookEvent(makeHookEvent({
        type: 'agent_spawn',
        agentType: 'coder11111',
        agentPrompt: 'Fix the bug',
      }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_end', toolName: 'Edit', toolSuccess: false, toolOutput: 'Permission denied' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: false }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('[FAIL]');
      expect(sessions[0]!.summary).toContain('Permission denied');
    });

    it('tracks files edited per agent', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/index.ts', fileOp: 'M' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/new.ts', fileOp: 'A' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('src/index.ts');
      expect(sessions[0]!.summary).toContain('src/new.ts');
    });

    it('records agent output/result', () => {
      collector.recordHookEvent(makeHookEvent({
        type: 'agent_spawn',
        agentType: 'Explore',
        agentPrompt: 'Analyze architecture',
      }));
      collector.recordHookEvent(makeHookEvent({
        type: 'agent_done',
        toolSuccess: true,
        agentOutput: 'Found 15 modules across 3 layers',
      }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('Found 15 modules');
    });

    it('summary shows success/fail counts', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'coder11111' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: false }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'qa' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('3 total');
      expect(sessions[0]!.summary).toContain('2 success');
      expect(sessions[0]!.summary).toContain('1 failed');
    });

    it('handles interrupted agents (not done)', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore' }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('1 interrupted');
    });
  });

  describe('Error lessons', () => {
    it('saves error lessons to memory on finalize', () => {
      collector.recordChunk(makeChunk({ type: 'error', clean: 'TypeError: cannot read property x of undefined' }));
      collector.recordChunk(makeChunk({ type: 'error', clean: 'EACCES: permission denied /etc/secret' }));

      collector.finalize();
      const lessons = memory.getByType('pattern').find((e) => e.title === 'Error lessons');
      expect(lessons).toBeDefined();
      expect(lessons!.content).toContain('TypeError');
      expect(lessons!.content).toContain('EACCES');
    });

    it('includes agent errors in lessons', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'coder11111' }));
      collector.recordHookEvent(makeHookEvent({
        type: 'tool_end',
        toolName: 'Write',
        toolSuccess: false,
        toolOutput: 'ENOENT: no such directory src/missing/',
      }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: false }));

      collector.finalize();
      const lessons = memory.getByType('pattern').find((e) => e.title === 'Error lessons');
      expect(lessons).toBeDefined();
      expect(lessons!.content).toContain('ENOENT');
    });

    it('accumulates errors across sessions without duplicates', () => {
      const c1 = createSessionCollector(memory);
      c1.recordChunk(makeChunk({ type: 'error', clean: 'Error: module not found' }));
      c1.finalize();

      const c2 = createSessionCollector(memory);
      c2.recordChunk(makeChunk({ type: 'error', clean: 'Error: module not found' }));
      c2.recordChunk(makeChunk({ type: 'error', clean: 'Error: timeout exceeded' }));
      c2.finalize();

      const lessons = memory.getByType('pattern').find((e) => e.title === 'Error lessons');
      const lines = lessons!.content.split('\n');
      const moduleErrors = lines.filter((l) => l.includes('module not found'));
      expect(moduleErrors).toHaveLength(1);
      expect(lessons!.content).toContain('timeout exceeded');
    });

    it('skips empty error messages', () => {
      collector.recordChunk(makeChunk({ type: 'error', clean: '' }));
      collector.recordChunk(makeChunk({ type: 'error', clean: '   ' }));

      collector.finalize();
      const lessons = memory.getByType('pattern').find((e) => e.title === 'Error lessons');
      expect(lessons).toBeUndefined();
    });

    it('errors appear in session summary', () => {
      collector.recordChunk(makeChunk({ type: 'error', clean: 'Build failed: type mismatch' }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('Errors to learn from');
      expect(sessions[0]!.summary).toContain('Build failed');
    });
  });

  describe('File tracking', () => {
    it('deduplicates file changes', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/a.ts', fileOp: 'M' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/a.ts', fileOp: 'M' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/a.ts', fileOp: 'M' }));

      collector.finalize();
      const sessions = memory.getSessions();
      const fileEntries = sessions[0]!.filesChanged.filter((f) => f.includes('src/a.ts'));
      expect(fileEntries).toHaveLength(1);
    });

    it('tracks file changes from watcher', () => {
      collector.recordFileChange('src/new.ts', 'A');
      collector.recordFileChange('README.md', 'M');

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.filesChanged).toContain('A src/new.ts');
      expect(sessions[0]!.filesChanged).toContain('M README.md');
    });

    it('persists tracked files to memory', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/critical.ts', fileOp: 'M' }));
      collector.finalize();

      const context = memory.buildContext();
      expect(context).toContain('src/critical.ts');
    });

    it('file changes appear in summary changelog', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/new.ts', fileOp: 'A' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/old.ts', fileOp: 'D' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/main.ts', fileOp: 'M' }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('Created: src/new.ts');
      expect(sessions[0]!.summary).toContain('Deleted: src/old.ts');
      expect(sessions[0]!.summary).toContain('Modified: src/main.ts');
    });
  });

  describe('Conversation capture', () => {
    it('captures meaningful main pane output', () => {
      collector.recordChunk(makeChunk({
        type: 'main',
        clean: 'Here is my analysis of the project architecture.',
      }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('analysis of the project');
    });

    it('skips short/empty lines', () => {
      collector.recordChunk(makeChunk({ type: 'main', clean: '' }));
      collector.recordChunk(makeChunk({ type: 'main', clean: 'ok' }));
      collector.recordChunk(makeChunk({ type: 'main', clean: '>' }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).not.toContain('What was done');
    });

    it('skips border characters', () => {
      collector.recordChunk(makeChunk({ type: 'main', clean: '│ some box border content' }));
      collector.recordChunk(makeChunk({ type: 'main', clean: '┌────────────────────┐' }));

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).not.toContain('border');
    });
  });

  describe('Tech stack auto-detection', () => {
    it('detects typescript from .ts files', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/index.ts', fileOp: 'M' }));
      collector.finalize();

      const techStack = memory.getByType('architecture').find((e) => e.title === 'Tech Stack');
      expect(techStack).toBeDefined();
      expect(techStack!.content).toContain('typescript');
    });

    it('detects python from .py files', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'app/main.py', fileOp: 'M' }));
      collector.finalize();

      const techStack = memory.getByType('architecture').find((e) => e.title === 'Tech Stack');
      expect(techStack!.content).toContain('python');
    });

    it('detects docker from Dockerfile', () => {
      collector.recordFileChange('Dockerfile', 'M');
      collector.finalize();

      const techStack = memory.getByType('architecture').find((e) => e.title === 'Tech Stack');
      expect(techStack!.content).toContain('docker');
    });

    it('detects multiple technologies in one session', () => {
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/index.ts', fileOp: 'M' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'backend/app.py', fileOp: 'M' }));
      collector.recordFileChange('Dockerfile', 'A');
      collector.recordFileChange('next.config.js', 'M');
      collector.finalize();

      const techStack = memory.getByType('architecture').find((e) => e.title === 'Tech Stack');
      expect(techStack!.content).toContain('typescript');
      expect(techStack!.content).toContain('python');
      expect(techStack!.content).toContain('docker');
      expect(techStack!.content).toContain('nextjs');
    });

    it('does not duplicate Tech Stack on second session', () => {
      const c1 = createSessionCollector(memory);
      c1.recordChunk(makeChunk({ type: 'file', filePath: 'src/a.ts', fileOp: 'M' }));
      c1.finalize();

      const c2 = createSessionCollector(memory);
      c2.recordChunk(makeChunk({ type: 'file', filePath: 'src/b.ts', fileOp: 'M' }));
      c2.finalize();

      const techStacks = memory.getByType('architecture').filter((e) => e.title === 'Tech Stack');
      expect(techStacks).toHaveLength(1);
    });
  });

  describe('Summary format', () => {
    it('includes duration', () => {
      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toMatch(/Duration: \d+/);
    });

    it('includes tool and file counts in header', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Read' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'a.ts', fileOp: 'M' }));
      collector.finalize();

      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('Tools: 1');
      expect(sessions[0]!.summary).toContain('Files: 1');
    });

    it('produces a coherent multi-section summary', () => {
      collector.recordChunk(makeChunk({ type: 'main', clean: 'I will analyze the codebase and fix the bug.' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore', agentPrompt: 'Find the bug' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Read' }));
      collector.recordHookEvent(makeHookEvent({ type: 'tool_end', toolName: 'Read', toolSuccess: true, toolOutput: '150 lines' }));
      collector.recordChunk(makeChunk({ type: 'file', filePath: 'src/fix.ts', fileOp: 'M' }));
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true, agentOutput: 'Bug found in line 42' }));
      collector.recordChunk(makeChunk({ type: 'error', clean: 'Warning: deprecated API usage' }));

      collector.finalize();
      const sessions = memory.getSessions();
      const s = sessions[0]!.summary;

      expect(s).toContain('Duration:');
      expect(s).toContain('What was done:');
      expect(s).toContain('analyze the codebase');
      expect(s).toContain('Agents: 1 total');
      expect(s).toContain('#1 Explore [OK]');
      expect(s).toContain('Find the bug');
      expect(s).toContain('Bug found in line 42');
      expect(s).toContain('File changes:');
      expect(s).toContain('src/fix.ts');
      expect(s).toContain('Errors to learn from');
      expect(s).toContain('deprecated API');
    });

    it('empty session produces minimal summary', () => {
      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('Duration:');
      expect(sessions[0]!.summary).toContain('Tools: 0');
    });
  });

  describe('Edge cases', () => {
    it('handles agent spawn without done', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: 'Explore' }));
      collector.finalize();

      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('interrupted');
    });

    it('handles agent done without spawn', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));
      collector.finalize();

      const sessions = memory.getSessions();
      expect(sessions).toHaveLength(1);
    });

    it('handles rapid sequential agents', () => {
      for (let i = 0; i < 5; i++) {
        collector.recordHookEvent(makeHookEvent({ type: 'agent_spawn', agentType: `Agent${i}`, agentPrompt: `Task ${i}` }));
        collector.recordHookEvent(makeHookEvent({ type: 'tool_start', toolName: 'Read' }));
        collector.recordHookEvent(makeHookEvent({ type: 'tool_end', toolName: 'Read', toolSuccess: true }));
        collector.recordHookEvent(makeHookEvent({ type: 'agent_done', toolSuccess: true }));
      }

      collector.finalize();
      const sessions = memory.getSessions();
      expect(sessions[0]!.summary).toContain('5 total');
      expect(sessions[0]!.summary).toContain('5 success');
    });

    it('handles very long error messages', () => {
      const longError = 'Error: ' + 'x'.repeat(500);
      collector.recordChunk(makeChunk({ type: 'error', clean: longError }));
      collector.finalize();

      const lessons = memory.getByType('pattern').find((e) => e.title === 'Error lessons');
      expect(lessons!.content.length).toBeLessThan(200);
    });

    it('handles many file changes', () => {
      for (let i = 0; i < 50; i++) {
        collector.recordChunk(makeChunk({ type: 'file', filePath: `src/file${i}.ts`, fileOp: 'M' }));
      }
      collector.finalize();

      const sessions = memory.getSessions();
      expect(sessions[0]!.filesChanged.length).toBeLessThanOrEqual(20);
      expect(sessions[0]!.summary).toContain('Files: 50');
    });

    it('handles tool_end without matching tool_start', () => {
      collector.recordHookEvent(makeHookEvent({ type: 'tool_end', toolName: 'Read', toolSuccess: true }));
      expect(collector.stats.toolCalls).toBe(0);
    });
  });
});
