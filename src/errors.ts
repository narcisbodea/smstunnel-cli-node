import { ApiError } from './api';
import { DASHBOARD_URL, EXIT } from './constants';

export interface CliErrorDetails {
  status?: number;
  code?: string;
  permission?: string;
  retryAfter?: number;
  messageId?: string;
}

/** An error the user should read, with the exit code the process ends with. */
export class CliError extends Error {
  readonly exitCode: number;
  readonly details: CliErrorDetails;

  constructor(message: string, exitCode: number, details: CliErrorDetails = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function usageError(message: string): CliError {
  return new CliError(message, EXIT.USAGE);
}

export type Operation = 'login' | 'phones' | 'send' | 'code' | 'status' | 'received' | 'usage';

export interface ErrorContext {
  operation: Operation;
  /** Where the key came from: SMSTUNNEL_API_KEY, the saved key, or the one just pasted at login. */
  keySource?: 'env' | 'stored' | 'typed';
  apiBase: string;
  /** The send carried --idempotency-key: running the same command again can't send a second text. */
  idempotencyKey?: boolean;
}

function host(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}

const sends = (operation: Operation) => operation === 'send' || operation === 'code';

const DASHBOARD_KEY_HINT = `Create a key in your dashboard (${DASHBOARD_URL} → Apps → Add an app)`;

const SAME_KEY_AGAIN = 'Run the same command again with the same --idempotency-key: SMSTunnel will not send the text twice.';

/** What a refused or failed API call means for the person at the keyboard, and the exit code. */
export function describeApiError(error: ApiError, context: ErrorContext): CliError {
  const { operation } = context;
  const details: CliErrorDetails = {
    status: error.status,
    code: error.code,
    permission: error.permission,
    retryAfter: error.retryAfter,
  };

  if (error.kind === 'network' || error.kind === 'timeout') {
    if (sends(operation) && error.mayHaveArrived) {
      return new CliError(
        `The connection to SMSTunnel broke after the text was handed over, so it may have gone out. ` +
          (context.idempotencyKey
            ? SAME_KEY_AGAIN
            : `Check the Messages page in your dashboard (${DASHBOARD_URL}) before you send it again.`),
        EXIT.UNAVAILABLE,
        details,
      );
    }
    const why = error.kind === 'timeout' ? 'no answer in time' : error.networkCode ?? error.message;
    return new CliError(
      `Could not reach SMSTunnel at ${host(context.apiBase)} (${why}). Check your internet connection and try again.`,
      EXIT.UNAVAILABLE,
      details,
    );
  }

  if (error.kind === 'redirect') {
    return new CliError(
      `${host(context.apiBase)} answered with a redirect (HTTP ${error.status}). Check the API address (--api-base).`,
      EXIT.UNAVAILABLE,
      details,
    );
  }

  if (error.kind === 'invalid-response') {
    return new CliError(
      `Unexpected answer from ${host(context.apiBase)} (HTTP ${error.status}): it is not the SMSTunnel API. Check the API address (--api-base).`,
      EXIT.UNAVAILABLE,
      details,
    );
  }

  const status = error.status ?? 0;
  const said = error.message;

  if (status === 400) {
    return new CliError(`SMSTunnel refused the request: ${said}`, EXIT.USAGE, details);
  }

  if (status === 422 && error.code === 'IDEMPOTENCY_KEY_REUSED') {
    return new CliError(
      'This --idempotency-key was already used in the last 24 hours for a different text (another number, message, phone or ' +
        'country code, or "code" instead of "send"). Nothing was sent. Use a new key for a new text.',
      EXIT.USAGE,
      details,
    );
  }

  if (status === 409 && error.code === 'IDEMPOTENCY_KEY_IN_PROGRESS') {
    const seconds = Math.max(1, error.retryAfter ?? 1);
    return new CliError(
      `SMSTunnel is still handling an earlier request with this --idempotency-key. Run the same command again in ${seconds} ` +
        `second${seconds === 1 ? '' : 's'} to get its answer; it will not send a second text.`,
      EXIT.RATE_LIMITED,
      details,
    );
  }

  if (status === 401) {
    const from =
      context.keySource === 'env'
        ? ' (the key in SMSTUNNEL_API_KEY)'
        : context.keySource === 'typed'
          ? ''
          : ' (the saved key)';
    const next = operation === 'login' || context.keySource === 'env' ? '.' : ', then run "smstunnel login" again.';
    return new CliError(
      `SMSTunnel refused the API key${from}: it is wrong, deactivated or deleted. ${DASHBOARD_KEY_HINT}${next}`,
      EXIT.AUTH,
      details,
    );
  }

  if (status === 403) {
    if (error.code === 'PERMISSION_REQUIRED') {
      switch (error.permission) {
        case 'sms:inbox':
          return new CliError(
            `This API key may not read received texts. In your dashboard (${DASHBOARD_URL} → Apps), choose ` +
              '"Allow reading received texts" for this key, or add an app with "Can also read received texts" ticked. ' +
              'Your phone also needs "Sync received texts" turned on in the SMSTunnel app; only texts that arrive after that are synced.',
            EXIT.FORBIDDEN,
            details,
          );
        case 'sms:send':
          return new CliError(
            `This API key may not send texts (it lacks the "sms:send" permission). ${DASHBOARD_KEY_HINT}.`,
            EXIT.FORBIDDEN,
            details,
          );
        case 'sms:read':
          return new CliError(
            `This API key may not check whether texts went out (it lacks the "sms:read" permission). ${DASHBOARD_KEY_HINT}.`,
            EXIT.FORBIDDEN,
            details,
          );
        default:
          return new CliError(
            `This API key lacks the "${error.permission ?? 'needed'}" permission. ${said}`,
            EXIT.FORBIDDEN,
            details,
          );
      }
    }
    return new CliError(`SMSTunnel refused this: ${said}`, EXIT.FORBIDDEN, details);
  }

  if (status === 404) {
    if (operation === 'status') {
      return new CliError('No text with that id for this key.', EXIT.NOT_FOUND, details);
    }
    if (sends(operation) || operation === 'received') {
      return new CliError(
        `${said}. List your phones and their ids with "smstunnel phones".`,
        EXIT.NOT_FOUND,
        details,
      );
    }
    return new CliError(`Not found: ${said}`, EXIT.NOT_FOUND, details);
  }

  if (status === 429) {
    if (error.retryAfter !== undefined) {
      const seconds = Math.max(1, error.retryAfter);
      const what = sends(operation)
        ? 'Too many texts in a minute: SMSTunnel takes up to 30 send requests a minute.'
        : 'Too many requests in a minute.';
      return new CliError(
        `${what} Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
        EXIT.RATE_LIMITED,
        details,
      );
    }
    // No Retry-After: the plan's allowance for today (or this month) is used up.
    const text = said && !/^HTTP \d+$/.test(said) ? said : "Your plan's allowance for today is used up.";
    return new CliError(text, EXIT.RATE_LIMITED, details);
  }

  if (status >= 500) {
    if (sends(operation)) {
      const first = error.replayed
        ? `SMSTunnel had a problem (HTTP ${status}) with the first request that used this --idempotency-key, and gives that same answer for 24 hours. `
        : `SMSTunnel had a problem (HTTP ${status}). `;
      const then = context.idempotencyKey
        ? `The text may or may not have been taken: check the Messages page in your dashboard (${DASHBOARD_URL}). Running the command again with the same key gets this answer again; use a new key only once you know the text did not go out.`
        : `The text may or may not have been taken: check the Messages page in your dashboard (${DASHBOARD_URL}) before you send it again.`;
      return new CliError(first + then, EXIT.UNAVAILABLE, details);
    }
    return new CliError(
      `SMSTunnel had a problem (HTTP ${status}). Try again in a little while.`,
      EXIT.UNAVAILABLE,
      details,
    );
  }

  return new CliError(`SMSTunnel refused the request (HTTP ${status}): ${said}`, EXIT.UNEXPECTED, details);
}
