#!/usr/bin/env node
/**
 * Mock Claude Code CLI for sandbox testing of the Mission Control TUI.
 * Replaces the real `claude` binary during development/test runs.
 * Reads lines from stdin and responds with canned scenario output.
 * @module mock-claude
 */

import * as readline from 'node:readline';
import {
  thinkingScenario,
  toolsScenario,
  agentsScenario,
  filesScenario,
  stressScenario,
  allScenario,
  runScenario,
} from './scenarios.js';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * Prints the welcome banner that mimics real Claude Code startup output.
 */
function printBanner(): void {
  process.stdout.write('\n');
  process.stdout.write(`${BOLD}${CYAN}   ╔═══════════════════════════════════╗${RESET}\n`);
  process.stdout.write(`${BOLD}${CYAN}   ║  ${MAGENTA}Claude Code${CYAN}  (mock for testing)  ║${RESET}\n`);
  process.stdout.write(`${BOLD}${CYAN}   ╚═══════════════════════════════════╝${RESET}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${DIM}  Commands: test thinking | test tools | test agents${RESET}\n`);
  process.stdout.write(`${DIM}            test files | test all | test stress${RESET}\n`);
  process.stdout.write('\n');
  process.stdout.write(`${GREEN}✓ Mock claude ready${RESET}\n`);
  process.stdout.write('\n');
}

/**
 * Emits a generic Claude-like conversational response for unrecognised input.
 *
 * @param input - The raw user input that triggered this response
 */
async function respondGeneric(input: string): Promise<void> {
  process.stdout.write(`\n${BOLD}I'll help you with that.${RESET} Here's my analysis:\n\n`);
  process.stdout.write(`${DIM}You said: "${input}"${RESET}\n\n`);
  process.stdout.write(`The code looks good overall. I'd suggest a few improvements:\n`);
  process.stdout.write(`  ${YELLOW}•${RESET} Consider extracting the repeated logic into a shared utility\n`);
  process.stdout.write(`  ${YELLOW}•${RESET} The naming could be more intention-revealing\n`);
  process.stdout.write(`  ${YELLOW}•${RESET} Add JSDoc to the public interface\n`);
  process.stdout.write('\n');
}

/**
 * Dispatches a user input line to the matching test scenario or generic handler.
 *
 * @param line - Trimmed user input string
 */
async function handleInput(line: string): Promise<void> {
  const command = line.trim().toLowerCase();

  if (command === 'test thinking') {
    await runScenario(thinkingScenario);
    return;
  }

  if (command === 'test tools') {
    await runScenario(toolsScenario);
    return;
  }

  if (command === 'test agents') {
    await runScenario(agentsScenario);
    return;
  }

  if (command === 'test files') {
    await runScenario(filesScenario);
    return;
  }

  if (command === 'test stress') {
    await runScenario(stressScenario);
    return;
  }

  if (command === 'test all') {
    await runScenario(allScenario);
    return;
  }

  if (command.length > 0) {
    await respondGeneric(line.trim());
  }
}

/**
 * Entry point — prints the banner, then enters an interactive readline loop
 * until stdin closes or the process receives SIGINT/SIGTERM.
 */
function main(): void {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: undefined,
    terminal: false,
  });

  let pendingHandler: Promise<void> = Promise.resolve();

  rl.on('line', (line: string) => {
    pendingHandler = pendingHandler.then(() => handleInput(line));
  });

  rl.on('close', () => {
    pendingHandler.then(() => {
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    process.exit(0);
  });
}

main();
