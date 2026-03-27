/**
 * Tests that agent output is correctly routed to agent panes.
 * Verifies the full flow: spawn detection → pane creation → content routing.
 * @module test/agent-routing
 */

import { describe, it, expect } from 'vitest';
import { createParser } from '../src/parser.js';

describe('Agent detection from real Claude Code output', () => {
  it('detects Explore(description) format as agent spawn', () => {
    const parser = createParser();
    const chunks = parser.feed('Explore(Explore root config files)\n');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.type).toBe('agent');
    expect(chunks[0]!.agentName).toBe('Explore: Explore root config files');
    expect(chunks[0]!.agentId).toBe('agent-1');
  });

  it('detects multiple agents with unique IDs', () => {
    const parser = createParser();
    const c1 = parser.feed('Explore(Explore root config files)\n');
    const c2 = parser.feed('Explore(Explore frontend directory)\n');
    const c3 = parser.feed('coder11111(Implement the feature)\n');

    expect(c1[0]!.agentId).toBe('agent-1');
    expect(c2[0]!.agentId).toBe('agent-2');
    expect(c3[0]!.agentId).toBe('agent-3');
    expect(c3[0]!.agentName).toBe('coder11111: Implement the feature');
  });

  it('detects Backgrounded agent as agent event', () => {
    const parser = createParser();
    parser.feed('Explore(Explore root config files)\n');
    const chunks = parser.feed('Backgrounded agent (↓ to manage · ctrl+o to expand)\n');
    expect(chunks[0]!.type).toBe('agent');
  });

  it('detects Done (N tool uses) as agent completion', () => {
    const parser = createParser();
    parser.feed('Explore(Explore root config files)\n');
    const chunks = parser.feed('Done (29 tool uses, 34.9k tokens, 49s)\n');
    expect(chunks[0]!.type).toBe('agent');
  });

  it('detects classic Spawned agent format', () => {
    const parser = createParser();
    const chunks = parser.feed('Spawned agent sub-agent-1 "Architecture analysis"\n');
    expect(chunks[0]!.type).toBe('agent');
    expect(chunks[0]!.agentId).toBe('agent-1');
  });

  it('thinking lines go to thinking, not agent panes', () => {
    const parser = createParser();
    parser.feed('Explore(Explore root config files)\n');
    const chunks = parser.feed('* Shimmying...\n');
    expect(chunks[0]!.type).toBe('thinking');
  });

  it('tool calls after agent spawn are classified as mcp', () => {
    const parser = createParser();
    parser.feed('Explore(Explore root config files)\n');
    const chunks = parser.feed('Tool: Read src/index.ts\n');
    expect(chunks[0]!.type).toBe('mcp');
  });

  it('file edits after agent spawn are classified as file', () => {
    const parser = createParser();
    parser.feed('Explore(Explore root config files)\n');
    const chunks = parser.feed('Created: src/utils/helper.ts\n');
    expect(chunks[0]!.type).toBe('file');
  });

  it('architect agent format detected', () => {
    const parser = createParser();
    const chunks = parser.feed('Architect(Design the new API layer)\n');
    expect(chunks[0]!.type).toBe('agent');
    expect(chunks[0]!.agentName).toContain('Architect');
  });

  it('qa agent format detected', () => {
    const parser = createParser();
    const chunks = parser.feed('qa(Run test suite and validate coverage)\n');
    expect(chunks[0]!.type).toBe('agent');
  });

  it('deploy agent format detected', () => {
    const parser = createParser();
    const chunks = parser.feed('deploy(Build and validate for production)\n');
    expect(chunks[0]!.type).toBe('agent');
  });

  it('general purpose agent format detected', () => {
    const parser = createParser();
    const chunks = parser.feed('general(Search for authentication patterns)\n');
    expect(chunks[0]!.type).toBe('agent');
  });
});

describe('Agent output routing simulation', () => {
  it('full agent lifecycle produces correct chunk sequence', () => {
    const parser = createParser();
    const all: Array<{ type: string; clean: string }> = [];

    const lines = [
      'Explore(Explore root config files)',
      'Backgrounded agent (↓ to manage · ctrl+o to expand)',
      '* Herding... (thinking with medium effort)',
      'Tool: Read package.json',
      'Created: src/new-module.ts',
      'Modified: src/index.ts',
      'The project uses TypeScript with a modular architecture.',
      'Done (12 tool uses, 15.2k tokens, 23s)',
    ];

    for (const line of lines) {
      const chunks = parser.feed(line + '\n');
      for (const c of chunks) {
        all.push({ type: c.type, clean: c.clean });
      }
    }

    expect(all[0]!.type).toBe('agent');
    expect(all[1]!.type).toBe('agent');
    expect(all[2]!.type).toBe('thinking');
    expect(all[3]!.type).toBe('mcp');
    expect(all[4]!.type).toBe('file');
    expect(all[5]!.type).toBe('file');
    expect(all[6]!.type).toBe('main');
    expect(all[7]!.type).toBe('agent');
  });

  it('parallel agents get unique IDs', () => {
    const parser = createParser();

    const c1 = parser.feed('Explore(Explore frontend)\n');
    const c2 = parser.feed('Explore(Explore backend)\n');

    expect(c1[0]!.agentId).toBe('agent-1');
    expect(c2[0]!.agentId).toBe('agent-2');
    expect(c1[0]!.agentId).not.toBe(c2[0]!.agentId);
  });

  it('agent done reuses last known agent ID', () => {
    const parser = createParser();

    parser.feed('Explore(Explore frontend)\n');
    parser.feed('Explore(Explore backend)\n');
    const done = parser.feed('Done (5 tool uses, 8k tokens, 10s)\n');

    expect(done[0]!.type).toBe('agent');
    expect(done[0]!.agentId).toBe('agent-2');
  });
});

describe('Hook-based agent detection', () => {
  it('hook agent_spawn creates correct event structure', async () => {
    const { createHookServer } = await import('../src/hooks/hook-server.js');
    const { createOrchestrator } = await import('../src/orchestrator.js');
    const net = await import('node:net');
    const crypto = await import('node:crypto');

    const server = createHookServer();
    const orchestrator = createOrchestrator();
    const sessionId = crypto.randomBytes(6).toString('hex');

    await server.start(sessionId);

    const events: Array<{ type: string }> = [];
    server.onEvent((e) => {
      events.push(e);
      orchestrator.handleEvent(e);
    });

    await new Promise<void>((resolve, reject) => {
      const client = net.createConnection(server.ipcPath, () => {
        client.write(JSON.stringify({
          hookType: 'PreToolUse',
          timestamp: Date.now(),
          payload: {
            tool_name: 'Agent',
            tool_input: {
              agentType: 'Explore',
              agentPrompt: 'Find all API endpoints',
              agentModel: 'sonnet',
            },
          },
        }) + '\n');
        client.end();
      });
      client.on('close', () => resolve());
      client.on('error', reject);
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('agent_spawn');
    expect(orchestrator.activeAgentCount).toBe(1);

    const rendered = orchestrator.render();
    const text = rendered.join('\n');
    expect(text).toContain('Explore');
    expect(text).toContain('Find all API endpoints');

    await server.stop();
  });
});
