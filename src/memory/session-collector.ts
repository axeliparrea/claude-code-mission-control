/**
 * Automatically collects meaningful context during a Mission Control session.
 * Tracks what was asked, what agents did, what files changed, and what was decided.
 * Saves a useful summary that serves as context for the next session.
 * @module memory/session-collector
 */

import type { ProjectMemory, SessionSummary } from './project-memory.js';
import type { HookEvent } from '../hooks/hook-server.js';
import type { ParsedChunk } from '../types.js';

/**
 * Collects session data and saves to project memory on close.
 */
export interface SessionCollector {
  recordHookEvent(event: HookEvent): void;
  recordChunk(chunk: ParsedChunk): void;
  recordFileChange(filePath: string, changeType: 'M' | 'A' | 'D'): void;
  finalize(): void;
  readonly stats: SessionStats;
}

export interface SessionStats {
  agentsUsed: number;
  toolCalls: number;
  filesChanged: number;
  thinkingLines: number;
  errors: number;
  duration: number;
}

interface FileChange {
  path: string;
  op: 'M' | 'A' | 'D';
}

interface AgentRecord {
  type: string;
  prompt: string;
  output: string[];
}

/**
 * Creates a SessionCollector that captures real, useful context.
 */
export function createSessionCollector(memory: ProjectMemory): SessionCollector {
  const startedAt = Date.now();
  const toolNames = new Set<string>();
  const fileChanges: FileChange[] = [];
  const fileSet = new Set<string>();
  const agentRecords: AgentRecord[] = [];
  const conversationLines: string[] = [];
  const errorMessages: string[] = [];
  const detectedPatterns = new Set<string>();
  let currentAgent: AgentRecord | null = null;
  let toolCalls = 0;
  let errors = 0;

  function autoDetectFromFile(filePath: string): void {
    if (/package\.json$/.test(filePath)) detectedPatterns.add('nodejs');
    if (/tsconfig\.json$/.test(filePath)) detectedPatterns.add('typescript');
    if (/\.py$/.test(filePath)) detectedPatterns.add('python');
    if (/\.rs$/.test(filePath)) detectedPatterns.add('rust');
    if (/\.go$/.test(filePath)) detectedPatterns.add('golang');
    if (/\.tsx?$/.test(filePath)) detectedPatterns.add('typescript');
    if (/\.jsx?$/.test(filePath)) detectedPatterns.add('javascript');
    if (/Dockerfile/.test(filePath)) detectedPatterns.add('docker');
    if (/\.sql$/.test(filePath)) detectedPatterns.add('sql');
    if (/\.vue$/.test(filePath)) detectedPatterns.add('vue');
    if (/\.svelte$/.test(filePath)) detectedPatterns.add('svelte');
    if (/next\.config/.test(filePath)) detectedPatterns.add('nextjs');
    if (/vite\.config/.test(filePath)) detectedPatterns.add('vite');
  }

  function buildChangelog(): string {
    const added = fileChanges.filter((f) => f.op === 'A').map((f) => f.path);
    const modified = fileChanges.filter((f) => f.op === 'M').map((f) => f.path);
    const deleted = fileChanges.filter((f) => f.op === 'D').map((f) => f.path);
    const parts: string[] = [];
    if (added.length > 0) parts.push(`Created: ${added.slice(0, 10).join(', ')}`);
    if (modified.length > 0) parts.push(`Modified: ${modified.slice(0, 10).join(', ')}`);
    if (deleted.length > 0) parts.push(`Deleted: ${deleted.slice(0, 5).join(', ')}`);
    return parts.join('\n') || 'No file changes';
  }

  function buildAgentSummary(): string {
    if (agentRecords.length === 0) return '';
    const lines: string[] = [];
    for (const agent of agentRecords) {
      const outputPreview = agent.output.slice(-3).join('; ').slice(0, 150);
      lines.push(`- ${agent.type}: ${agent.prompt.slice(0, 100)}${outputPreview ? ' → ' + outputPreview : ''}`);
    }
    return lines.join('\n');
  }

  function buildSummary(): string {
    const duration = Math.floor((Date.now() - startedAt) / 1000);
    const mins = Math.floor(duration / 60);
    const secs = duration % 60;
    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

    const sections: string[] = [];

    sections.push(`Duration: ${durationStr}`);

    if (conversationLines.length > 0) {
      const topics = conversationLines.slice(0, 5).map((l) => l.slice(0, 100));
      sections.push(`What was discussed:\n${topics.map((t) => `- ${t}`).join('\n')}`);
    }

    const changelog = buildChangelog();
    if (changelog !== 'No file changes') {
      sections.push(`File changes:\n${changelog}`);
    }

    const agentSummary = buildAgentSummary();
    if (agentSummary) {
      sections.push(`Agents used:\n${agentSummary}`);
    }

    if (toolCalls > 0) {
      sections.push(`Tools: ${toolCalls} calls (${[...toolNames].slice(0, 8).join(', ')})`);
    }

    if (errorMessages.length > 0) {
      sections.push(`Errors:\n${errorMessages.slice(0, 5).map((e) => `- ${e.slice(0, 100)}`).join('\n')}`);
    }

    return sections.join('\n\n');
  }

  return {
    recordHookEvent(event: HookEvent): void {
      if (event.type === 'tool_start') {
        toolCalls++;
        if (event.toolName) toolNames.add(event.toolName);
      }
      if (event.type === 'tool_end' && event.toolOutput) {
        if (currentAgent) {
          const preview = typeof event.toolOutput === 'string'
            ? event.toolOutput.slice(0, 80)
            : JSON.stringify(event.toolOutput).slice(0, 80);
          currentAgent.output.push(`${event.toolName}: ${preview}`);
        }
      }
      if (event.type === 'agent_spawn') {
        currentAgent = {
          type: event.agentType ?? 'unknown',
          prompt: event.agentPrompt ?? '',
          output: [],
        };
        agentRecords.push(currentAgent);
      }
      if (event.type === 'agent_done') {
        if (currentAgent && event.agentOutput) {
          currentAgent.output.push(event.agentOutput.slice(0, 200));
        }
        currentAgent = null;
      }
    },

    recordChunk(chunk: ParsedChunk): void {
      if (chunk.type === 'file' && chunk.filePath) {
        if (!fileSet.has(chunk.filePath)) {
          fileSet.add(chunk.filePath);
          fileChanges.push({ path: chunk.filePath, op: chunk.fileOp ?? 'M' });
          autoDetectFromFile(chunk.filePath);
          memory.trackFile(chunk.filePath, `${chunk.fileOp ?? 'M'} during session`);
        }
      }
      if (chunk.type === 'error') {
        errors++;
        if (chunk.clean.trim().length > 5) {
          errorMessages.push(chunk.clean.trim());
        }
      }
      if (chunk.type === 'mcp' && chunk.toolName) {
        toolCalls++;
        toolNames.add(chunk.toolName);
      }
      if (chunk.type === 'main') {
        const clean = chunk.clean.replace(/[\r\n]+/g, ' ').trim();
        if (clean.length > 20 && !/^\s*[│┌┘└┐╭╮╯╰─]/.test(clean)) {
          if (conversationLines.length < 30) {
            conversationLines.push(clean);
          }
        }
      }
      if (chunk.type === 'agent') {
        if (chunk.agentName && currentAgent) {
          currentAgent.type = chunk.agentName;
        }
      }
    },

    recordFileChange(filePath: string, changeType: 'M' | 'A' | 'D'): void {
      if (!fileSet.has(filePath)) {
        fileSet.add(filePath);
        fileChanges.push({ path: filePath, op: changeType });
        autoDetectFromFile(filePath);
        memory.trackFile(filePath, `${changeType} detected by watcher`);
      }
    },

    finalize(): void {
      const endedAt = Date.now();
      const fullSummary = buildSummary();

      const summary: Omit<SessionSummary, 'id'> = {
        startedAt,
        endedAt,
        agentsUsed: agentRecords.length,
        toolCalls,
        filesChanged: fileChanges.map((f) => `${f.op} ${f.path}`).slice(0, 20),
        thinkingTopics: conversationLines.slice(0, 5),
        summary: fullSummary,
      };

      memory.saveSession(summary);

      if (detectedPatterns.size > 0) {
        const existing = memory.getByType('architecture');
        const hasTechStack = existing.some((e) => e.title === 'Tech Stack');
        if (!hasTechStack) {
          memory.save({
            type: 'architecture',
            title: 'Tech Stack',
            content: `Detected: ${[...detectedPatterns].join(', ')}`,
            tags: [...detectedPatterns],
            relevance: 5,
          });
        }
      }
    },

    get stats(): SessionStats {
      return {
        agentsUsed: agentRecords.length,
        toolCalls,
        filesChanged: fileSet.size,
        thinkingLines: conversationLines.length,
        errors,
        duration: Date.now() - startedAt,
      };
    },
  };
}
