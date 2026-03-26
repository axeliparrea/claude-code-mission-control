#!/usr/bin/env node

/**
 * Hook forward script — Claude Code executes this as a hook subprocess.
 * Reads JSON from stdin, forwards it to Mission Control via IPC unix socket.
 * Always exits 0 to never block Claude Code.
 *
 * Uses .mjs extension to guarantee ESM mode regardless of parent package.json.
 */

import { createConnection } from 'node:net';

const ipcPath = process.env.MC_IPC_PATH;
if (!ipcPath) process.exit(0);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const parsed = JSON.parse(raw);
    const client = createConnection(ipcPath, () => {
      client.write(JSON.stringify({
        hookType: process.argv[2] || 'unknown',
        timestamp: Date.now(),
        payload: parsed
      }) + '\n');
      client.end();
    });
    client.on('error', () => {});
    client.unref();
  } catch {
  }
  setTimeout(() => process.exit(0), 1000).unref();
});
