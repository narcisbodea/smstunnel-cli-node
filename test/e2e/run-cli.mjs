// Runs the built CLI (dist/cli.js) as a child process, the way people run it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../dist/cli.js');

/** This process's environment without any SMSTUNNEL_* variable, plus the given ones. */
export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.toUpperCase().startsWith('SMSTUNNEL_')) delete env[name];
  for (const [name, value] of Object.entries(extra)) {
    if (value === undefined) delete env[name];
    else env[name] = value;
  }
  return env;
}

/** A fresh config folder, so no test ever reads or writes the real one or the system keychain. */
export function tempConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smstunnel-cli-e2e-'));
  return {
    dir,
    env: { SMSTUNNEL_CONFIG_DIR: path.join(dir, 'config'), SMSTUNNEL_KEY_STORE: 'file' },
    configFile: path.join(dir, 'config', 'config.json'),
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Resolves with { code, signal, stdout, stderr }. stdin gets `input` (if any) and is closed, as in a
 * script. onStdout(stdout, child) sees the output as it grows (for --watch).
 */
export function runCli(args, { env, input, timeoutMs = 30_000, onStdout } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      onStdout?.(stdout, child);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}
