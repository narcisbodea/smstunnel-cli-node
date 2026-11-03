import { EXIT } from './constants';
import { CliError } from './errors';

/**
 * Reads the API key: hidden (shown as *) when typed or pasted in a terminal, or the first line of
 * stdin when it is piped (echo "$KEY" | smstunnel login).
 */
export async function readSecret(question: string): Promise<string> {
  const stdin = process.stdin;
  if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
    return readHidden(question);
  }
  process.stderr.write(question);
  const line = await readFirstLine();
  process.stderr.write('\n');
  return line;
}

function readHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  const out = process.stderr;
  out.write(question);
  return new Promise((resolve, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const finish = (error?: Error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      out.write('\n');
      if (error) reject(error);
      else resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          return;
        }
        if (ch === '\u0003') {
          finish(new CliError('Stopped.', EXIT.INTERRUPTED));
          return;
        }
        if (ch === '\u0004') {
          finish();
          return;
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1);
            out.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue; // other control keys and escape sequences
        value += ch;
        out.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

/** The first non-empty line of stdin (or all of it, up to EOF, when it has no newline). */
export function readFirstLine(): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    let buffer = '';
    const done = (value: string) => {
      stdin.removeListener('data', onData);
      stdin.removeListener('end', onEnd);
      stdin.removeListener('error', onError);
      stdin.pause();
      resolve(value.trim());
    };
    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      const complete = lines.slice(0, -1).find((line) => line.trim() !== '');
      if (complete !== undefined) done(complete);
    };
    const onEnd = () => done(buffer.split(/\r?\n/).find((line) => line.trim() !== '') ?? '');
    const onError = (error: Error) => reject(error);
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onError);
    stdin.resume();
  });
}

/** All of stdin, for a text piped into "smstunnel send <number>". */
export function readAllStdin(maxBytes = 64 * 1024): Promise<string> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stdin.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new CliError('The text on standard input is too long.', EXIT.USAGE));
        stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stdin.on('error', reject);
  });
}
