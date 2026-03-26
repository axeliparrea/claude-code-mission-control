#!/usr/bin/env node
/**
 * Enhanced mock Claude Code CLI for sandbox testing.
 * Simulates Claude Code output including thinking, tools, agents, and files.
 * Also sends hook events via IPC if MC_IPC_PATH is set.
 * @module sandbox/mock-claude
 */

import * as readline from 'node:readline';
import * as net from 'node:net';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * Sends a hook event to the Mission Control IPC server if running.
 */
function sendHookEvent(hookType: string, payload: Record<string, unknown>): void {
  const ipcPath = process.env['MC_IPC_PATH'];
  if (!ipcPath) return;

  try {
    const client = net.createConnection(ipcPath, () => {
      client.write(JSON.stringify({
        hookType,
        timestamp: Date.now(),
        payload,
      }) + '\n');
      client.end();
    });
    client.on('error', () => {});
    client.unref();
  } catch {
  }
}

/**
 * Waits for the given milliseconds.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prints the welcome banner.
 */
function printBanner(): void {
  process.stdout.write('\n');
  process.stdout.write(`${BOLD}${CYAN}   ╔═══════════════════════════════════╗${RESET}\n`);
  process.stdout.write(`${BOLD}${CYAN}   ║  ${MAGENTA}Claude Code${CYAN}  (sandbox mock)      ║${RESET}\n`);
  process.stdout.write(`${BOLD}${CYAN}   ╚═══════════════════════════════════╝${RESET}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${DIM}  Commands: test thinking | test tools | test agents${RESET}\n`);
  process.stdout.write(`${DIM}            test files | test all | test stress | test hooks${RESET}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${GREEN}✓ Mock claude ready${RESET}\n\n`);
}

/**
 * Simulates a thinking block.
 */
async function testThinking(): Promise<void> {
  process.stdout.write(`${YELLOW}⚡ Thinking...${RESET}\n`);
  await wait(200);
  process.stdout.write(`${DIM}Let me analyze the problem step by step.${RESET}\n`);
  await wait(300);
  process.stdout.write(`${DIM}The codebase uses a modular pattern with dependency injection.${RESET}\n`);
  await wait(300);
  process.stdout.write(`${DIM}I see several potential approaches here.${RESET}\n`);
  await wait(250);
  process.stdout.write(`${DIM}Option A aligns better with the existing SOLID structure.${RESET}\n`);
  await wait(500);
  process.stdout.write('\n');
  process.stdout.write(`${BOLD}Based on my analysis, here is the recommended approach:${RESET}\n`);
  process.stdout.write(`Refactor the parser layer using Option A.\n\n`);
}

/**
 * Simulates tool calls with hook events.
 */
async function testTools(): Promise<void> {
  const tools = [
    { name: 'Read', input: { file_path: 'src/index.ts' }, output: '245 lines', success: true },
    { name: 'Glob', input: { pattern: '**/*.ts' }, output: '12 matches', success: true },
    { name: 'Edit', input: { file_path: 'src/parser.ts' }, output: '3 changes applied', success: true },
    { name: 'Bash', input: { command: 'npm test' }, output: 'exit 0', success: true },
    { name: 'Write', input: { file_path: 'src/broken.ts' }, output: 'Permission denied', success: false },
  ];

  for (const tool of tools) {
    sendHookEvent('PreToolUse', { tool_name: tool.name, tool_input: tool.input });
    process.stdout.write(`${YELLOW}⏳ ${tool.name} ${JSON.stringify(tool.input)}${RESET}\n`);
    await wait(300);

    sendHookEvent('PostToolUse', {
      tool_name: tool.name,
      tool_input: tool.input,
      tool_output: tool.output,
      tool_success: tool.success,
    });

    if (tool.success) {
      process.stdout.write(`${GREEN}✓ ${tool.name} (${tool.output})${RESET}\n`);
    } else {
      process.stdout.write(`${RED}✗ ${tool.name} — ${tool.output}${RESET}\n`);
    }
    await wait(200);
  }
  process.stdout.write('\n');
}

/**
 * Simulates agent spawning with hook events.
 */
async function testAgents(): Promise<void> {
  sendHookEvent('PreToolUse', {
    tool_name: 'Agent',
    tool_input: {
      agentType: 'Explore',
      agentPrompt: 'Analyze the project architecture and identify key modules',
      agentModel: 'sonnet',
    },
  });
  process.stdout.write(`${BLUE}Spawned agent sub-agent-1 "Architecture analysis"${RESET}\n`);
  await wait(400);

  process.stdout.write(`${DIM}[sub-agent-1] Analyzing project structure...${RESET}\n`);
  await wait(600);
  process.stdout.write(`${DIM}[sub-agent-1] Found 15 modules across 3 layers${RESET}\n`);
  await wait(500);

  sendHookEvent('PostToolUse', {
    tool_name: 'Agent',
    tool_output: { agentOutput: 'Architecture analysis complete', confidence: 92 },
    tool_success: true,
  });
  process.stdout.write(`${GREEN}[sub-agent-1] ✓ Architecture analysis complete${RESET}\n`);
  process.stdout.write(`${DIM}Agent completed${RESET}\n`);
  await wait(400);

  sendHookEvent('PreToolUse', {
    tool_name: 'Agent',
    tool_input: {
      agentType: 'coder11111',
      agentPrompt: 'Implement the new helper module based on architecture analysis',
      agentModel: 'sonnet',
    },
  });
  process.stdout.write(`${BLUE}Spawned agent sub-agent-2 "Implementation"${RESET}\n`);
  await wait(500);

  process.stdout.write(`${DIM}[sub-agent-2] Writing new module...${RESET}\n`);
  await wait(700);
  process.stdout.write(`${DIM}[sub-agent-2] → Creating src/utils/helper.ts${RESET}\n`);
  await wait(400);

  sendHookEvent('PostToolUse', {
    tool_name: 'Agent',
    tool_output: { agentOutput: 'Implementation complete', confidence: 88 },
    tool_success: true,
  });
  process.stdout.write(`${GREEN}[sub-agent-2] ✓ Implementation complete${RESET}\n`);
  process.stdout.write(`${DIM}Agent completed${RESET}\n`);
  process.stdout.write(`${MAGENTA}returned to main${RESET}\n\n`);
}

/**
 * Simulates file changes.
 */
async function testFiles(): Promise<void> {
  const files = [
    { op: 'Modified', path: 'src/index.ts' },
    { op: 'Created', path: 'src/utils/helper.ts' },
    { op: 'Modified', path: 'src/parser.ts' },
    { op: 'Deleted', path: 'src/old-config.json' },
    { op: 'Created', path: 'test/parser.test.ts' },
  ];

  for (const file of files) {
    process.stdout.write(`${file.op}: ${file.path}\n`);
    await wait(150);
  }
  process.stdout.write('\n');
}

/**
 * Tests hook events specifically — sends structured data via IPC.
 */
async function testHooks(): Promise<void> {
  process.stdout.write(`${CYAN}Testing hook event delivery...${RESET}\n`);

  sendHookEvent('PreToolUse', { tool_name: 'WebSearch', tool_input: { query: 'vitest best practices' } });
  process.stdout.write(`${YELLOW}⏳ WebSearch "vitest best practices"${RESET}\n`);
  await wait(500);

  sendHookEvent('PostToolUse', { tool_name: 'WebSearch', tool_output: '5 results', tool_success: true });
  process.stdout.write(`${GREEN}✓ WebSearch (5 results)${RESET}\n`);
  await wait(300);

  sendHookEvent('PreToolUse', {
    tool_name: 'Agent',
    tool_input: { agentType: 'qa', agentPrompt: 'Run test suite and validate coverage', agentModel: 'haiku' },
  });
  process.stdout.write(`${BLUE}Spawned agent qa "Run test suite"${RESET}\n`);
  await wait(1000);

  sendHookEvent('PostToolUse', {
    tool_name: 'Agent',
    tool_output: { agentOutput: 'All 214 tests passing', confidence: 98 },
    tool_success: true,
  });
  process.stdout.write(`${GREEN}✓ QA agent done (214 tests passing)${RESET}\n`);
  await wait(200);

  sendHookEvent('Stop', {});
  process.stdout.write(`${DIM}Session complete.${RESET}\n\n`);
}

/**
 * Runs all scenarios in sequence.
 */
async function testAll(): Promise<void> {
  await testThinking();
  await wait(1000);
  await testTools();
  await wait(1000);
  await testAgents();
  await wait(1000);
  await testFiles();
  await wait(1000);
  await testHooks();
}

/**
 * Stress test — rapid-fire output.
 */
async function testStress(): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const patterns = [
      () => `${YELLOW}⏳ Read src/file-${i}.ts${RESET}`,
      () => `${GREEN}✓ Read (${100 + i} lines)${RESET}`,
      () => `Modified: src/component-${i}.ts`,
      () => `${DIM}Thinking about step ${i}...${RESET}`,
    ];
    const pick = patterns[i % patterns.length];
    if (pick) process.stdout.write(pick() + '\n');
    if (i % 10 === 0) {
      sendHookEvent('PreToolUse', { tool_name: 'Read', tool_input: { file_path: `src/file-${i}.ts` } });
    }
    await wait(10);
  }
  process.stdout.write('\n');
}

/**
 * Dispatches a user input line to the matching scenario.
 */
async function handleInput(line: string): Promise<void> {
  const cmd = line.trim().toLowerCase();

  const handlers: Record<string, () => Promise<void>> = {
    'test thinking': testThinking,
    'test tools': testTools,
    'test agents': testAgents,
    'test files': testFiles,
    'test hooks': testHooks,
    'test all': testAll,
    'test stress': testStress,
  };

  const handler = handlers[cmd];
  if (handler) {
    await handler();
    return;
  }

  if (cmd.length > 0) {
    process.stdout.write(`\n${BOLD}I'll help you with that.${RESET}\n`);
    process.stdout.write(`${DIM}You said: "${line.trim()}"${RESET}\n\n`);
  }
}

/**
 * Entry point.
 */
function main(): void {
  printBanner();

  const rl = readline.createInterface({ input: process.stdin, output: undefined, terminal: false });
  let pending: Promise<void> = Promise.resolve();

  rl.on('line', (line: string) => {
    pending = pending.then(() => handleInput(line));
  });

  rl.on('close', () => { pending.then(() => process.exit(0)); });
  process.on('SIGINT', () => { process.exit(0); });
  process.on('SIGTERM', () => { process.exit(0); });
}

main();
