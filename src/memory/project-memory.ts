/**
 * Persistent project memory — stores and retrieves context per repository.
 * Data lives in `.mc/` inside the project root, surviving across sessions.
 * @module memory/project-memory
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * A single memory entry with metadata.
 */
export interface MemoryEntry {
  id: string;
  type: 'session' | 'architecture' | 'pattern' | 'decision' | 'file_map' | 'conversation' | 'custom';
  title: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  relevance: number;
}

/**
 * Session summary stored after each MC session.
 */
export interface SessionSummary {
  id: string;
  startedAt: number;
  endedAt: number;
  agentsUsed: number;
  toolCalls: number;
  filesChanged: string[];
  thinkingTopics: string[];
  summary: string;
}

/**
 * Manages persistent project memory on disk.
 */
export interface ProjectMemory {
  /**
   * Loads all memory entries from disk.
   */
  load(): void;

  /**
   * Saves a new memory entry.
   */
  save(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): MemoryEntry;

  /**
   * Updates an existing memory entry by ID.
   */
  update(id: string, updates: Partial<Pick<MemoryEntry, 'title' | 'content' | 'tags' | 'relevance'>>): void;

  /**
   * Searches memory entries by keyword (simple text search).
   */
  search(query: string, limit?: number): MemoryEntry[];

  /**
   * Returns all memory entries.
   */
  getAll(): MemoryEntry[];

  /**
   * Returns entries of a specific type.
   */
  getByType(type: MemoryEntry['type']): MemoryEntry[];

  /**
   * Saves a session summary.
   */
  saveSession(summary: Omit<SessionSummary, 'id'>): void;

  /**
   * Returns all past session summaries.
   */
  getSessions(): SessionSummary[];

  /**
   * Builds a context string suitable for injecting into Claude Code.
   * Includes most relevant memories, recent sessions, and project structure.
   */
  buildContext(maxChars?: number): string;

  /**
   * Records that a file was important in this session.
   */
  trackFile(filePath: string, reason: string): void;

  /**
   * Returns the .mc directory path.
   */
  readonly memoryDir: string;
}

const DEFAULT_MAX_CONTEXT_CHARS = 8000;

/**
 * Generates a short unique ID.
 */
function generateId(): string {
  return crypto.randomBytes(6).toString('hex');
}

/**
 * Ensures a directory exists.
 */
function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Reads and parses a JSON file, returning a fallback on failure.
 */
function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * Writes an object as formatted JSON.
 */
function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * Simple text relevance score — counts keyword matches.
 */
function textScore(text: string, query: string): number {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (lower.includes(word)) score++;
  }
  return score;
}

/**
 * Creates a ProjectMemory instance for the given project directory.
 * @param projectDir - Absolute path to the project root
 */
export function createProjectMemory(projectDir: string): ProjectMemory {
  const mcDir = path.join(projectDir, '.mc');
  const memDir = path.join(mcDir, 'memory');
  const sessionsDir = path.join(mcDir, 'sessions');
  const entriesFile = path.join(memDir, 'entries.json');
  const filesFile = path.join(memDir, 'tracked-files.json');

  let entries: MemoryEntry[] = [];
  let trackedFiles: Record<string, string[]> = {};

  return {
    get memoryDir(): string {
      return mcDir;
    },

    load(): void {
      ensureDir(memDir);
      ensureDir(sessionsDir);
      entries = readJson<MemoryEntry[]>(entriesFile, []);
      trackedFiles = readJson<Record<string, string[]>>(filesFile, {});

      const hasProjectInfo = entries.some((e) => e.title === 'Project Info');
      const hasPkg = fs.existsSync(path.join(projectDir, 'package.json'));
      const hasGit = fs.existsSync(path.join(projectDir, '.git'));

      if (!hasProjectInfo && (hasPkg || hasGit)) {
        const info: string[] = [];
        info.push(`Directory: ${projectDir}`);
        info.push(`Name: ${path.basename(projectDir)}`);

        if (hasPkg) {
          try {
            const pkg = readJson<Record<string, unknown>>(path.join(projectDir, 'package.json'), {});
            if (pkg['name']) info.push(`Package: ${pkg['name']}`);
            if (pkg['description']) info.push(`Description: ${pkg['description']}`);
          } catch { }
        }

        if (hasGit) {
          try {
            const gitHead = fs.readFileSync(path.join(projectDir, '.git', 'HEAD'), 'utf8').trim();
            const branch = gitHead.replace('ref: refs/heads/', '');
            info.push(`Git branch: ${branch}`);
            try {
              const remote = fs.readFileSync(path.join(projectDir, '.git', 'config'), 'utf8');
              const urlMatch = /url\s*=\s*(.+)/m.exec(remote);
              if (urlMatch?.[1]) info.push(`Remote: ${urlMatch[1].trim()}`);
            } catch { }
          } catch { }
        }

        const entry: MemoryEntry = {
          id: generateId(),
          type: 'architecture',
          title: 'Project Info',
          content: info.join('\n'),
          tags: ['project', 'meta'],
          relevance: 10,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        entries.push(entry);
        writeJson(entriesFile, entries);
      }
    },

    save(input: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): MemoryEntry {
      const now = Date.now();
      const entry: MemoryEntry = {
        ...input,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      entries.push(entry);
      ensureDir(memDir);
      writeJson(entriesFile, entries);
      return entry;
    },

    update(id: string, updates: Partial<Pick<MemoryEntry, 'title' | 'content' | 'tags' | 'relevance'>>): void {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;

      if (updates.title !== undefined) entry.title = updates.title;
      if (updates.content !== undefined) entry.content = updates.content;
      if (updates.tags !== undefined) entry.tags = updates.tags;
      if (updates.relevance !== undefined) entry.relevance = updates.relevance;
      entry.updatedAt = Date.now();

      writeJson(entriesFile, entries);
    },

    search(query: string, limit = 10): MemoryEntry[] {
      const scored = entries.map((entry) => ({
        entry,
        score: textScore(`${entry.title} ${entry.content} ${entry.tags.join(' ')}`, query) + entry.relevance,
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).filter((s) => s.score > 0).map((s) => s.entry);
    },

    getAll(): MemoryEntry[] {
      return [...entries];
    },

    getByType(type: MemoryEntry['type']): MemoryEntry[] {
      return entries.filter((e) => e.type === type);
    },

    saveSession(summary: Omit<SessionSummary, 'id'>): void {
      const session: SessionSummary = { ...summary, id: generateId() };
      ensureDir(sessionsDir);
      const sessionFile = path.join(sessionsDir, `${session.id}.json`);
      writeJson(sessionFile, session);
    },

    getSessions(): SessionSummary[] {
      ensureDir(sessionsDir);
      const sessions: SessionSummary[] = [];
      let files: string[];
      try {
        files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.json'));
      } catch {
        return sessions;
      }
      for (const file of files) {
        const session = readJson<SessionSummary | null>(path.join(sessionsDir, file), null);
        if (session) sessions.push(session);
      }
      sessions.sort((a, b) => b.startedAt - a.startedAt);
      return sessions;
    },

    buildContext(maxChars = DEFAULT_MAX_CONTEXT_CHARS): string {
      const sections: string[] = [];

      const recentSessions = this.getSessions().slice(0, 3);
      if (recentSessions.length > 0) {
        sections.push('## Recent Sessions');
        for (const s of recentSessions) {
          const date = new Date(s.startedAt).toISOString().split('T')[0];
          sections.push(`- ${date}: ${s.summary} (${s.agentsUsed} agents, ${s.toolCalls} tools, ${s.filesChanged.length} files)`);
        }
      }

      const archEntries = this.getByType('architecture');
      if (archEntries.length > 0) {
        sections.push('\n## Architecture');
        for (const e of archEntries.slice(0, 5)) {
          sections.push(`- ${e.title}: ${e.content.slice(0, 200)}`);
        }
      }

      const decisions = this.getByType('decision');
      if (decisions.length > 0) {
        sections.push('\n## Decisions');
        for (const e of decisions.slice(0, 5)) {
          sections.push(`- ${e.title}: ${e.content.slice(0, 200)}`);
        }
      }

      const patterns = this.getByType('pattern');
      if (patterns.length > 0) {
        sections.push('\n## Patterns');
        for (const e of patterns.slice(0, 5)) {
          sections.push(`- ${e.title}: ${e.content.slice(0, 200)}`);
        }
      }

      const fileKeys = Object.keys(trackedFiles);
      if (fileKeys.length > 0) {
        sections.push('\n## Important Files');
        for (const file of fileKeys.slice(0, 15)) {
          const reasons = trackedFiles[file] ?? [];
          sections.push(`- ${file}: ${reasons[reasons.length - 1] ?? ''}`);
        }
      }

      let context = sections.join('\n');
      if (context.length > maxChars) {
        context = context.slice(0, maxChars - 3) + '...';
      }
      return context;
    },

    trackFile(filePath: string, reason: string): void {
      const relative = path.relative(projectDir, path.resolve(projectDir, filePath));
      const existing = trackedFiles[relative] ?? [];
      trackedFiles[relative] = [...existing.slice(-4), reason];
      ensureDir(memDir);
      writeJson(filesFile, trackedFiles);
    },
  };
}
