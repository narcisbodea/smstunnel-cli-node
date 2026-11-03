import * as http from 'node:http';
import * as https from 'node:https';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'redirect' | 'invalid-response';

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  permission?: string;
  retryAfter?: number;
  body?: unknown;
  networkCode?: string;
  /** The request reached SMSTunnel, or may have: a text may have been taken. */
  mayHaveArrived: boolean;
  /** SMSTunnel answered `Idempotent-Replayed: true`: the stored answer to an earlier request with the same Idempotency-Key. */
  replayed?: boolean;
}

/** A call SMSTunnel refused, or that never got an answer. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly permission?: string;
  readonly retryAfter?: number;
  readonly body?: unknown;
  readonly networkCode?: string;
  readonly mayHaveArrived: boolean;
  readonly replayed: boolean;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status;
    this.code = init.code;
    this.permission = init.permission;
    this.retryAfter = init.retryAfter;
    this.body = init.body;
    this.networkCode = init.networkCode;
    this.mayHaveArrived = init.mayHaveArrived;
    this.replayed = init.replayed === true;
  }
}

/** An answer with what the headers said about it. */
export interface ApiAnswer<T> {
  body: T;
  /** `Idempotent-Replayed: true`: SMSTunnel sent back the answer to the first request with this Idempotency-Key. */
  replayed: boolean;
}

export interface ApiClientOptions {
  /** For example https://smstunnel.io/api/v1, without a trailing slash. */
  apiBase: string;
  apiKey: string;
  userAgent: string;
  timeoutMs?: number;
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Errors raised before the request could leave this computer: nothing reached SMSTunnel. */
const NEVER_ARRIVED = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** Retry-After in seconds (a number of seconds or an HTTP date), or undefined. */
export function parseRetryAfter(value: string | string[] | undefined, now: number = Date.now()): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw.trim() === '') return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(1, Math.ceil((date - now) / 1000));
}

/** The words SMSTunnel put in an error body: `message` may be a list (validation errors). */
export function errorMessageFrom(body: unknown, text: string, status: number): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.message)) {
      const parts = b.message.filter((m) => typeof m === 'string' && m.trim() !== '') as string[];
      if (parts.length > 0) return parts.join('; ');
    }
    if (typeof b.message === 'string' && b.message.trim() !== '') return b.message.trim();
    if (typeof b.error === 'string' && b.error.trim() !== '') return b.error.trim();
  }
  const plain = text.trim();
  if (plain !== '' && plain.length <= 300 && !plain.startsWith('<')) return plain;
  return `HTTP ${status}`;
}

function rawRequest(
  method: string,
  url: URL,
  headers: Record<string, string>,
  payload: string | undefined,
  timeoutMs: number,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    let written = false;
    let settled = false;
    const fail = (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      reject(Object.assign(error, { requestWritten: written }));
    };
    const req = lib.request(url, { method, headers, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          req.destroy(Object.assign(new Error('The answer was too large'), { code: 'ETOOLARGE' }));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', (error) => fail(error));
      res.on('close', () => {
        if (!res.complete) fail(Object.assign(new Error('The connection closed early'), { code: 'ECONNRESET' }));
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('finish', () => {
      written = true;
    });
    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('No answer in time'), { code: 'ETIMEDOUT' }));
    });
    req.on('error', (error) => fail(error));
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

/** Calls the SMSTunnel REST API with an API key, over node:https (no dependencies, no fetch warning). */
export class ApiClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.base = options.apiBase.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.userAgent = options.userAgent;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async get<T = any>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return (await this.request<T>('GET', path, query, undefined)).body;
  }

  async post<T = any>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    return (await this.request<T>('POST', path, undefined, body, extraHeaders)).body;
  }

  /** A POST that also says whether SMSTunnel replayed an earlier answer (Idempotency-Key). */
  postWithAnswer<T = any>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<ApiAnswer<T>> {
    return this.request<T>('POST', path, undefined, body, extraHeaders);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Record<string, string | number | undefined> | undefined,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<ApiAnswer<T>> {
    const url = new URL(this.base + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(name, String(value));
    }
    const payload = body === undefined ? undefined : JSON.stringify(body);
    // The key travels only in this header, never in the URL.
    const headers: Record<string, string> = {
      ...extraHeaders,
      'X-API-Key': this.apiKey,
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    let raw: RawResponse;
    try {
      raw = await rawRequest(method, url, headers, payload, this.timeoutMs);
    } catch (error) {
      const e = error as NodeJS.ErrnoException & { requestWritten?: boolean };
      const networkCode = e.code ?? 'ERROR';
      const timedOut = networkCode === 'ETIMEDOUT';
      throw new ApiError({
        kind: timedOut ? 'timeout' : 'network',
        message: e.message,
        networkCode,
        mayHaveArrived: Boolean(e.requestWritten) && !NEVER_ARRIVED.has(networkCode),
      });
    }

    const replayedHeader = raw.headers['idempotent-replayed'];
    const replayed = (Array.isArray(replayedHeader) ? replayedHeader[0] : replayedHeader)?.trim().toLowerCase() === 'true';

    let parsed: unknown = undefined;
    if (raw.text.trim() !== '') {
      try {
        parsed = JSON.parse(raw.text);
      } catch {
        parsed = undefined;
      }
    }

    if (raw.status >= 300 && raw.status < 400) {
      throw new ApiError({
        kind: 'redirect',
        status: raw.status,
        message: `Redirect to ${String(raw.headers.location ?? 'somewhere else')}`,
        mayHaveArrived: true,
      });
    }
    if (raw.status >= 400 || raw.status < 200) {
      const b = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
      throw new ApiError({
        kind: 'http',
        status: raw.status,
        message: errorMessageFrom(parsed, raw.text, raw.status),
        code: typeof b.code === 'string' ? b.code : undefined,
        permission: typeof b.permission === 'string' ? b.permission : undefined,
        retryAfter: parseRetryAfter(raw.headers['retry-after']),
        body: parsed,
        mayHaveArrived: true,
        replayed,
      });
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new ApiError({
        kind: 'invalid-response',
        status: raw.status,
        message: 'The answer was not JSON',
        mayHaveArrived: true,
      });
    }
    if ((parsed as { success?: unknown }).success === false) {
      throw new ApiError({
        kind: 'http',
        status: raw.status,
        message: errorMessageFrom(parsed, raw.text, raw.status),
        body: parsed,
        mayHaveArrived: true,
        replayed,
      });
    }
    return { body: parsed as T, replayed };
  }
}
