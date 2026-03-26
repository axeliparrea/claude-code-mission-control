/**
 * Reusable test scenario definitions for mock-claude and unit tests.
 * Each scenario describes a sequence of output lines with per-line delays,
 * enabling realistic timing simulation of Claude Code output.
 * @module scenarios
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

/**
 * A single line of output paired with a delay before emission.
 */
export interface ScenarioLine {
  /** Text to write to stdout, without a trailing newline. */
  text: string;
  /** Milliseconds to wait before emitting this line. */
  delayMs: number;
}

/**
 * A named sequence of output lines that simulates a Claude Code output pattern.
 */
export interface TestScenario {
  /** Human-readable identifier for this scenario. */
  name: string;
  /** Ordered sequence of lines with individual timing. */
  lines: ScenarioLine[];
}

/**
 * Simulates an extended thinking block with deliberate per-line pauses.
 */
export const thinkingScenario: TestScenario = {
  name: 'thinking',
  lines: [
    { text: `${YELLOW}⚡ Thinking...${RESET}`, delayMs: 0 },
    { text: `${DIM}Let me analyze the problem step by step.${RESET}`, delayMs: 120 },
    { text: `${DIM}First, I need to understand the current architecture.${RESET}`, delayMs: 180 },
    { text: `${DIM}The codebase uses a modular pattern with dependency injection.${RESET}`, delayMs: 200 },
    { text: `${DIM}I see several potential approaches here.${RESET}`, delayMs: 150 },
    { text: `${DIM}Considering the trade-offs between performance and maintainability...${RESET}`, delayMs: 220 },
    { text: `${DIM}Option A: refactor the parser layer — minimal surface area.${RESET}`, delayMs: 180 },
    { text: `${DIM}Option B: introduce an event bus — more flexible but adds coupling.${RESET}`, delayMs: 200 },
    { text: `${DIM}Option A aligns better with the existing SOLID structure.${RESET}`, delayMs: 160 },
    { text: '', delayMs: 2000 },
    { text: `${BOLD}Based on my analysis, here is the recommended approach:${RESET}`, delayMs: 0 },
    { text: `Refactor the parser layer using Option A for minimal impact.`, delayMs: 80 },
  ],
};

/**
 * Simulates multiple tool calls with status icons and realistic spacing.
 */
export const toolsScenario: TestScenario = {
  name: 'tools',
  lines: [
    { text: `${YELLOW}⏳ Read src/index.ts${RESET}`, delayMs: 0 },
    { text: `${GREEN}✓ Read (245 lines)${RESET}`, delayMs: 300 },
    { text: `${YELLOW}⏳ Glob **/*.ts${RESET}`, delayMs: 100 },
    { text: `${GREEN}✓ Glob (12 matches)${RESET}`, delayMs: 250 },
    { text: `${YELLOW}⏳ Edit src/parser.ts${RESET}`, delayMs: 150 },
    { text: `${GREEN}✓ Edit (applied 3 changes)${RESET}`, delayMs: 400 },
    { text: `${YELLOW}⏳ Bash npm test${RESET}`, delayMs: 100 },
    { text: `${GREEN}✓ Bash (exit 0)${RESET}`, delayMs: 800 },
    { text: `${YELLOW}⏳ Write src/broken.ts${RESET}`, delayMs: 100 },
    { text: `${RED}✗ Write src/broken.ts — Permission denied${RESET}`, delayMs: 200 },
  ],
};

/**
 * Simulates two agent lifecycles with spawn, progress, and completion events.
 */
export const agentsScenario: TestScenario = {
  name: 'agents',
  lines: [
    { text: `${BLUE}Spawned agent sub-agent-1 "Architecture analysis"${RESET}`, delayMs: 0 },
    { text: `${DIM}[sub-agent-1] Analyzing project structure...${RESET}`, delayMs: 400 },
    { text: `${DIM}[sub-agent-1] Found 15 modules across 3 layers${RESET}`, delayMs: 600 },
    { text: `${GREEN}[sub-agent-1] ✓ Architecture analysis complete${RESET}`, delayMs: 500 },
    { text: `${DIM}Agent completed${RESET}`, delayMs: 200 },
    { text: '', delayMs: 400 },
    { text: `${BLUE}Spawned agent sub-agent-2 "Implementation"${RESET}`, delayMs: 0 },
    { text: `${DIM}[sub-agent-2] Writing new module...${RESET}`, delayMs: 500 },
    { text: `${DIM}[sub-agent-2] → Creating src/utils/helper.ts${RESET}`, delayMs: 700 },
    { text: `${DIM}[sub-agent-2] → Updating src/index.ts${RESET}`, delayMs: 400 },
    { text: '', delayMs: 3000 },
    { text: `${GREEN}[sub-agent-2] ✓ Implementation complete${RESET}`, delayMs: 0 },
    { text: `${DIM}Agent completed${RESET}`, delayMs: 200 },
    { text: `${MAGENTA}returned to main${RESET}`, delayMs: 300 },
  ],
};

/**
 * Simulates file-change output with one entry per affected path.
 */
export const filesScenario: TestScenario = {
  name: 'files',
  lines: [
    { text: `Modified: src/index.ts`, delayMs: 0 },
    { text: `Created: src/utils/helper.ts`, delayMs: 200 },
    { text: `Modified: src/parser.ts`, delayMs: 150 },
    { text: `Deleted: src/old-config.json`, delayMs: 100 },
    { text: `Modified: package.json`, delayMs: 120 },
    { text: `Created: test/parser.test.ts`, delayMs: 180 },
  ],
};

/**
 * Builds a single stress-test line from a rotating set of output patterns.
 */
function buildStressLine(index: number): string {
  const patterns = [
    () => `${YELLOW}⏳ Read src/file-${index}.ts${RESET}`,
    () => `${GREEN}✓ Read (${100 + index} lines)${RESET}`,
    () => `${DIM}[sub-agent-1] Processing item ${index}...${RESET}`,
    () => `Modified: src/component-${index}.ts`,
    () => `${DIM}Let me think about step ${index}...${RESET}`,
    () => `${RED}✗ Bash (exit 1) — Error on line ${index}${RESET}`,
    () => `${BLUE}Spawned agent worker-${index} "Task ${index}"${RESET}`,
    () => `${GREEN}[worker-${index}] ✓ Done${RESET}`,
  ];

  const pick = patterns[index % patterns.length];
  return pick ? pick() : `Line ${index}`;
}

/**
 * Generates 200 mixed output lines at 10 ms intervals to stress-test the renderer.
 */
export const stressScenario: TestScenario = {
  name: 'stress',
  lines: Array.from({ length: 200 }, (_, i) => ({
    text: buildStressLine(i),
    delayMs: 10,
  })),
};

/**
 * Combines all individual scenarios with 2-second gaps between each.
 */
export const allScenario: TestScenario = {
  name: 'all',
  lines: [
    ...thinkingScenario.lines,
    { text: '', delayMs: 2000 },
    ...toolsScenario.lines,
    { text: '', delayMs: 2000 },
    ...agentsScenario.lines,
    { text: '', delayMs: 2000 },
    ...filesScenario.lines,
  ],
};

/**
 * Writes a single scenario line to stdout after the line's specified delay.
 * Returns a Promise that resolves once the line has been written.
 */
function emitLine(line: ScenarioLine): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      process.stdout.write(line.text + '\n');
      resolve();
    }, line.delayMs);
  });
}

/**
 * Runs a test scenario by emitting each line to stdout in order,
 * respecting per-line delays. Delays are relative to the previous line's
 * emission, not absolute from scenario start.
 *
 * @param scenario - The scenario to execute
 * @returns A Promise that resolves when all lines have been emitted
 */
export async function runScenario(scenario: TestScenario): Promise<void> {
  for (const line of scenario.lines) {
    await emitLine(line);
  }
}
