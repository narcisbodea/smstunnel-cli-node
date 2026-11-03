import { ApiClient, ApiError } from './api';
import { DASHBOARD_URL, DEFAULT_API_BASE, EXIT, VERSION } from './constants';
import { CliError, describeApiError, Operation, usageError } from './errors';
import { loadKey, LoadedKey, readConfig } from './store';

export interface Device {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt?: string | null;
}

export interface DevicesData {
  devices: Device[];
  online: number;
  total: number;
}

export interface StatusData {
  id: string;
  phoneNumber?: string;
  status: string;
  unconfirmed?: boolean;
  deliveryStatus?: string;
  sentAt?: string | null;
  deliveredAt?: string | null;
  errorMessage?: string | null;
}

/** Prints for people (stdout), notes and warnings (stderr), or JSON (stdout). */
export class Output {
  constructor(readonly json: boolean) {}

  line(text = ''): void {
    process.stdout.write(`${text}\n`);
  }

  note(text: string): void {
    process.stderr.write(`${text}\n`);
  }

  data(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }

  /** One JSON value per line (received --watch --json). */
  jsonLine(value: unknown): void {
    process.stdout.write(`${JSON.stringify(value)}\n`);
  }
}

export type ApiBaseSource = 'flag' | 'env' | 'config' | 'default';

export interface Context {
  json: boolean;
  apiBase: string;
  apiBaseSource: ApiBaseSource;
  options: Record<string, string | boolean>;
  env: Record<string, string | undefined>;
  out: Output;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** https only (http only for this computer); no credentials, query or fragment; "/api/v1" when no path. */
export function normalizeApiBase(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw usageError(`"${input}" is not a URL. Use something like https://smstunnel.io/api/v1.`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw usageError('The API address must start with https:// (http:// only for localhost).');
  }
  if (url.username || url.password) {
    throw usageError('The API address may not contain a user name or password.');
  }
  if (url.search || url.hash) {
    throw usageError('The API address may not contain "?" or "#".');
  }
  let pathname = url.pathname.replace(/\/+$/, '');
  if (pathname === '') pathname = '/api/v1';
  return `${url.protocol}//${url.host}${pathname}`;
}

export function buildContext(options: Record<string, string | boolean>, env = process.env): Context {
  const json = options.json === true;
  let apiBase = DEFAULT_API_BASE;
  let apiBaseSource: ApiBaseSource = 'default';
  if (typeof options['api-base'] === 'string') {
    apiBase = normalizeApiBase(options['api-base']);
    apiBaseSource = 'flag';
  } else if (env.SMSTUNNEL_API_BASE) {
    apiBase = normalizeApiBase(env.SMSTUNNEL_API_BASE);
    apiBaseSource = 'env';
  } else {
    const saved = readConfig(env).apiBase;
    if (saved) {
      apiBase = normalizeApiBase(saved);
      apiBaseSource = 'config';
    }
  }
  return { json, apiBase, apiBaseSource, options, env, out: new Output(json) };
}

export function requireKey(ctx: Context): LoadedKey {
  const loaded = loadKey(ctx.env);
  if (!loaded) {
    throw new CliError(
      `No API key yet. Run "smstunnel login" and paste a key from your dashboard (${DASHBOARD_URL} → Apps → Add an app), or set SMSTUNNEL_API_KEY.`,
      EXIT.AUTH,
    );
  }
  return loaded;
}

export function clientFor(ctx: Context, apiKey: string): ApiClient {
  return new ApiClient({
    apiBase: ctx.apiBase,
    apiKey,
    userAgent: `smstunnel-cli/${VERSION} (node ${process.version}; ${process.platform})`,
  });
}

/** Runs an API call and turns a refusal into a message for people, with its exit code. */
export async function call<T>(
  ctx: Context,
  operation: Operation,
  keySource: 'env' | 'stored' | 'typed',
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof ApiError) {
      throw describeApiError(error, { operation, keySource, apiBase: ctx.apiBase });
    }
    throw error;
  }
}

/** --phone: an id from "smstunnel phones" (or the app's id), or the phone's exact name. */
export async function resolvePhone(
  ctx: Context,
  client: ApiClient,
  keySource: 'env' | 'stored',
  value: string,
  operation: Operation,
): Promise<Device> {
  const wanted = value.trim();
  if (/^[0-9a-f]{24}$/i.test(wanted) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wanted)) {
    return { id: wanted, name: wanted, isOnline: true };
  }
  const response = await call(ctx, operation, keySource, () => client.get<{ data?: DevicesData }>('/devices'));
  const devices = response.data?.devices ?? [];
  let matches = devices.filter((device) => device.name === wanted);
  if (matches.length === 0) {
    matches = devices.filter((device) => device.name.toLowerCase() === wanted.toLowerCase());
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw usageError(`Several of your phones are called "${wanted}". Use the id instead (see "smstunnel phones").`);
  }
  const names = devices.map((device) => `"${device.name}"`).join(', ');
  throw usageError(
    devices.length === 0
      ? 'No phones are linked to your account yet.'
      : `No phone called "${wanted}". Your phones: ${names}. "smstunnel phones" shows their ids.`,
  );
}

/** Ctrl+C while waiting or watching: stop cleanly instead of dying mid-request. */
export class Interrupt {
  interrupted = false;
  private readonly wakers = new Set<() => void>();
  private readonly onSigint = () => {
    this.interrupted = true;
    for (const wake of this.wakers) wake();
    this.wakers.clear();
  };

  start(): this {
    process.on('SIGINT', this.onSigint);
    return this;
  }

  stop(): void {
    process.removeListener('SIGINT', this.onSigint);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.interrupted || ms <= 0) {
        resolve();
        return;
      }
      const wake = () => {
        clearTimeout(timer);
        this.wakers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      this.wakers.add(wake);
    });
  }
}

/** Polling pace; SMSTUNNEL_POLL_INTERVAL_MS exists only so tests can run fast. */
export function pollIntervalMs(env: Record<string, string | undefined>, fallbackMs: number): number {
  const override = Number(env.SMSTUNNEL_POLL_INTERVAL_MS);
  return Number.isFinite(override) && override >= 50 ? override : fallbackMs;
}

export function maskKey(key: string): string {
  if (key.length <= 14) return `${key.slice(0, 3)}…`;
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}
