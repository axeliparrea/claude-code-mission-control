/**
 * Agent orchestrator — tracks agent tree, tool counts, and task progress.
 * Builds formatted text lines for rendering in a TextPane.
 * @module orchestrator
 */

import { fg, icons } from './theme.js';
import type { HookEvent } from './hooks/hook-server.js';

/**
 * A tracked agent in the orchestrator tree.
 */
interface OrchestratorAgent {
  id: string;
  type: string;
  prompt: string;
  model: string;
  status: 'running' | 'done' | 'error';
  spawnedAt: number;
  completedAt?: number;
  confidence?: number;
  toolCalls: number;
  output?: string;
}

/**
 * A tracked tool call.
 */
interface TrackedToolCall {
  name: string;
  status: 'pending' | 'success' | 'error';
  timestamp: number;
}

/**
 * Manages agent tree and tool tracking, produces formatted text output.
 */
export interface Orchestrator {
  /**
   * Processes a hook event and updates internal state.
   */
  handleEvent(event: HookEvent): void;

  /**
   * Returns formatted text lines representing the current orchestrator state.
   */
  render(): string[];

  /**
   * Returns the count of active agents.
   */
  readonly activeAgentCount: number;

  /**
   * Returns total tool calls tracked.
   */
  readonly totalToolCalls: number;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * Creates a new Orchestrator instance.
 */
export function createOrchestrator(): Orchestrator {
  const agents: OrchestratorAgent[] = [];
  const recentTools: TrackedToolCall[] = [];
  const MAX_RECENT_TOOLS = 20;
  let totalTools = 0;
  let sessionStart = Date.now();

  function addAgent(event: HookEvent): void {
    const agent: OrchestratorAgent = {
      id: `agent-${agents.length + 1}`,
      type: event.agentType ?? 'unknown',
      prompt: event.agentPrompt?.slice(0, 80) ?? '',
      model: event.agentModel ?? '',
      status: 'running',
      spawnedAt: event.timestamp,
      toolCalls: 0,
    };
    agents.push(agent);
  }

  function completeLastAgent(event: HookEvent): void {
    const running = agents.filter((a) => a.status === 'running');
    const last = running[running.length - 1];
    if (last) {
      last.status = event.toolSuccess === false ? 'error' : 'done';
      last.completedAt = event.timestamp;
      last.confidence = event.confidence;
      last.output = event.agentOutput?.slice(0, 100);
    }
  }

  function addToolCall(event: HookEvent): void {
    totalTools++;
    const tool: TrackedToolCall = {
      name: event.toolName ?? 'unknown',
      status: 'pending',
      timestamp: event.timestamp,
    };
    recentTools.push(tool);
    if (recentTools.length > MAX_RECENT_TOOLS) {
      recentTools.shift();
    }

    const running = agents.filter((a) => a.status === 'running');
    const current = running[running.length - 1];
    if (current) {
      current.toolCalls++;
    }
  }

  function completeToolCall(event: HookEvent): void {
    const pending = recentTools.filter((t) => t.status === 'pending' && t.name === event.toolName);
    const match = pending[pending.length - 1];
    if (match) {
      match.status = event.toolSuccess === false ? 'error' : 'success';
    }
  }

  function formatDuration(ms: number): string {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = secs % 60;
    return `${mins}m${remainSecs}s`;
  }

  function statusIcon(status: string): string {
    if (status === 'running') return `${fg.success}${icons.pending}${RESET}`;
    if (status === 'done') return `${fg.success}${icons.success}${RESET}`;
    if (status === 'error') return `${fg.error}${icons.error}${RESET}`;
    if (status === 'pending') return `${fg.thinking}${icons.pending}${RESET}`;
    if (status === 'success') return `${fg.success}${icons.success}${RESET}`;
    return `${fg.textDim}?${RESET}`;
  }

  function renderAgentTree(): string[] {
    const lines: string[] = [];
    lines.push(`${BOLD}${fg.agent} Agent Tree${RESET}`);

    if (agents.length === 0) {
      lines.push(`${DIM}  (no agents spawned)${RESET}`);
      return lines;
    }

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i]!;
      const isLast = i === agents.length - 1;
      const connector = isLast ? '└─' : '├─';
      const icon = statusIcon(a.status);

      const duration = a.completedAt
        ? formatDuration(a.completedAt - a.spawnedAt)
        : formatDuration(Date.now() - a.spawnedAt);

      const conf = a.confidence !== undefined ? ` ${fg.textDim}${a.confidence}%${RESET}` : '';
      const model = a.model ? ` ${fg.textDim}(${a.model})${RESET}` : '';

      lines.push(`  ${connector} ${icon} ${fg.agent}${a.type}${RESET}${model} ${fg.textDim}${duration}${RESET}${conf}`);

      if (a.prompt) {
        const subConnector = isLast ? '   ' : '│  ';
        lines.push(`  ${subConnector} ${fg.textDim}${icons.arrow} ${a.prompt}${RESET}`);
      }

      if (a.toolCalls > 0) {
        const subConnector = isLast ? '   ' : '│  ';
        lines.push(`  ${subConnector} ${fg.textDim}${a.toolCalls} tools${RESET}`);
      }

      if (a.output && a.status === 'done') {
        const subConnector = isLast ? '   ' : '│  ';
        lines.push(`  ${subConnector} ${fg.success}${a.output}${RESET}`);
      }
    }

    return lines;
  }

  function renderToolFeed(): string[] {
    const lines: string[] = [];
    lines.push('');
    lines.push(`${BOLD}${fg.mcp} Recent Tools${RESET} ${fg.textDim}(${totalTools} total)${RESET}`);

    if (recentTools.length === 0) {
      lines.push(`${DIM}  (no tool calls yet)${RESET}`);
      return lines;
    }

    const visible = recentTools.slice(-10);
    for (const t of visible) {
      lines.push(`  ${statusIcon(t.status)} ${t.name}`);
    }

    return lines;
  }

  function renderStats(): string[] {
    const elapsed = formatDuration(Date.now() - sessionStart);
    const activeCount = agents.filter((a) => a.status === 'running').length;
    const doneCount = agents.filter((a) => a.status === 'done').length;
    const errorCount = agents.filter((a) => a.status === 'error').length;

    const lines: string[] = [];
    lines.push('');
    lines.push(`${BOLD}${fg.textPrimary} Session${RESET}`);
    lines.push(`  ${fg.textDim}Duration:${RESET} ${elapsed}`);
    lines.push(`  ${fg.textDim}Agents:${RESET} ${fg.success}${activeCount} running${RESET} ${fg.textDim}${doneCount} done${RESET}${errorCount > 0 ? ` ${fg.error}${errorCount} error${RESET}` : ''}`);
    lines.push(`  ${fg.textDim}Tools:${RESET} ${totalTools} total`);

    return lines;
  }

  return {
    handleEvent(event: HookEvent): void {
      if (event.type === 'agent_spawn') {
        addAgent(event);
      } else if (event.type === 'agent_done') {
        completeLastAgent(event);
      } else if (event.type === 'tool_start') {
        addToolCall(event);
      } else if (event.type === 'tool_end') {
        completeToolCall(event);
      }
    },

    render(): string[] {
      return [
        ...renderAgentTree(),
        ...renderToolFeed(),
        ...renderStats(),
      ];
    },

    get activeAgentCount(): number {
      return agents.filter((a) => a.status === 'running').length;
    },

    get totalToolCalls(): number {
      return totalTools;
    },
  };
}
