/**
 * Automatically collects context during a Mission Control session.
 * Tracks tools used, files changed, agents spawned, and thinking topics.
 * Saves a summary to project memory when the session ends.
 * @module memory/session-collector
 */

import type { ProjectMemory, SessionSummary } from './project-memory.js';
import type { HookEvent } from '../hooks/hook-server.js';
import type { ParsedChunk } from '../types.js';

/**
 * Collects session data and saves to project memory on close.
 */
export interface SessionCollector {
  /**
   * Records a hook event.
   */
  recordHookEvent(event: HookEvent): void;

  /**
   * Records a parsed PTY chunk.
   */
  recordChunk(chunk: ParsedChunk): void;

  /**
   * Records a file change from the watcher.
   */
  recordFileChange(filePath: string, changeType: 'M' | 'A' | 'D'): void;

  /**
   * Finalizes the session and saves summary to project memory.
   */
  finalize(): void;

  /**
   * Returns current session stats.
   */
  readonly stats: SessionStats;
}

/**
 * Live session statistics.
 */
export interface SessionStats {
  agentsUsed: number;
  toolCalls: number;
  filesChanged: number;
  thinkingLines: number;
  errors: number;
  duration: number;
}

/**
 * Creates a SessionCollector that records events and saves to memory on close.
 * @param memory - The project memory instance to save to
 */
export function createSessionCollector(memory: ProjectMemory): SessionCollector {
  const startedAt = Date.now();
  const toolNames = new Set<string>();
  const filesChanged = new Set<string>();
  const agentTypes = new Set<string>();
  const thinkingSnippets: string[] = [];
  let toolCalls = 0;
  let errors = 0;

  return {
    recordHookEvent(event: HookEvent): void {
      if (event.type === 'tool_start') {
        toolCalls++;
        if (event.toolName) toolNames.add(event.toolName);
      }
      if (event.type === 'agent_spawn') {
        if (event.agentType) agentTypes.add(event.agentType);
      }
    },

    recordChunk(chunk: ParsedChunk): void {
      if (chunk.type === 'thinking' && chunk.clean.length > 10) {
        if (thinkingSnippets.length < 20) {
          thinkingSnippets.push(chunk.clean.slice(0, 100));
        }
      }
      if (chunk.type === 'file' && chunk.filePath) {
        filesChanged.add(chunk.filePath);
        memory.trackFile(chunk.filePath, `${chunk.fileOp ?? 'M'} during session`);
      }
      if (chunk.type === 'error') {
        errors++;
      }
      if (chunk.type === 'mcp' && chunk.toolName) {
        toolCalls++;
        toolNames.add(chunk.toolName);
      }
    },

    recordFileChange(filePath: string, changeType: 'M' | 'A' | 'D'): void {
      filesChanged.add(filePath);
      memory.trackFile(filePath, `${changeType} detected by watcher`);
    },

    finalize(): void {
      const endedAt = Date.now();

      const toolList = [...toolNames].join(', ');
      const agentList = [...agentTypes].join(', ');
      const fileList = [...filesChanged].slice(0, 10);
      const thinkingTopics = thinkingSnippets.slice(0, 5);

      const summaryParts: string[] = [];
      if (toolCalls > 0) summaryParts.push(`${toolCalls} tool calls (${toolList})`);
      if (agentTypes.size > 0) summaryParts.push(`agents: ${agentList}`);
      if (filesChanged.size > 0) summaryParts.push(`${filesChanged.size} files changed`);
      if (errors > 0) summaryParts.push(`${errors} errors`);

      const summary: Omit<SessionSummary, 'id'> = {
        startedAt,
        endedAt,
        agentsUsed: agentTypes.size,
        toolCalls,
        filesChanged: fileList,
        thinkingTopics,
        summary: summaryParts.join('; ') || 'short session',
      };

      memory.saveSession(summary);
    },

    get stats(): SessionStats {
      return {
        agentsUsed: agentTypes.size,
        toolCalls,
        filesChanged: filesChanged.size,
        thinkingLines: thinkingSnippets.length,
        errors,
        duration: Date.now() - startedAt,
      };
    },
  };
}
