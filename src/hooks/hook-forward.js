#!/usr/bin/env node
const net = require('net');

const ipcPath = process.env.MC_IPC_PATH;
if (!ipcPath) process.exit(0);

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    const client = net.createConnection(ipcPath, () => {
      client.write(JSON.stringify({
        hookType: process.argv[2] || 'unknown',
        timestamp: Date.now(),
        payload: JSON.parse(raw)
      }) + '\n');
      client.end();
    });
    client.on('error', () => {});
    client.unref();
  } catch {
  }
  setTimeout(() => process.exit(0), 1000).unref();
});
