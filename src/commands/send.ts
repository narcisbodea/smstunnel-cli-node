import { ApiClient, ApiError } from '../api';
import { DASHBOARD_URL, EXIT, MAX_CODE_TEXT_LENGTH, MAX_TEXT_LENGTH } from '../constants';
import {
  call,
  clientFor,
  Context,
  Device,
  Interrupt,
  pollIntervalMs,
  requireKey,
  resolvePhone,
  StatusData,
} from '../context';
import { CliError, describeApiError, usageError } from '../errors';
import { checkCountryCode, checkRecipient } from '../numbers';
import { readAllStdin } from '../prompt';
import { containsSignInCode } from '../sign-in-code';
import { characterCount, smsParts } from '../sms-parts';
import { formatLocal, parseSeconds } from '../time';

interface SendResponse {
  success?: boolean;
  messageId?: string;
  queued?: boolean;
  data?: {
    messageId?: string;
    branded?: boolean;
    queued?: boolean;
    remaining?: unknown;
  };
}

export type SendKind = 'text' | 'code';

export type WaitOutcome = 'sent' | 'failed' | 'unconfirmed' | 'still-waiting' | 'interrupted';

const DEFAULT_TIMEOUT_SECONDS = 120;

/** A final state, or undefined while the text still waits for the phone. */
export function outcomeOf(status: StatusData): Exclude<WaitOutcome, 'still-waiting' | 'interrupted'> | undefined {
  if (status.unconfirmed === true || status.deliveryStatus === 'unconfirmed') return 'unconfirmed';
  if (status.status === 'sent' || status.status === 'delivered') return 'sent';
  if (status.status === 'failed') return 'failed';
  return undefined;
}

async function messageFrom(words: string[]): Promise<string> {
  let text: string;
  if (words.length === 1 && words[0] === '-') {
    text = await readAllStdin();
  } else if (words.length === 0 && !process.stdin.isTTY) {
    text = await readAllStdin();
  } else {
    text = words.join(' ');
  }
  // A text piped from echo ends with a newline nobody meant to send.
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

/** Polls GET /sms/status/:id until the phone sent it, it failed, the time is up or Ctrl+C. */
async function waitForPhone(
  ctx: Context,
  client: ApiClient,
  keySource: 'env' | 'stored',
  messageId: string,
  timeoutSeconds: number,
): Promise<{ outcome: WaitOutcome; status?: StatusData }> {
  const interrupt = new Interrupt().start();
  const deadline = Date.now() + timeoutSeconds * 1000;
  const interval = pollIntervalMs(ctx.env, 2000);
  let last: StatusData | undefined;
  let failures = 0;
  try {
    for (;;) {
      await interrupt.sleep(Math.min(interval, Math.max(0, deadline - Date.now())));
      if (interrupt.interrupted) return { outcome: 'interrupted', status: last };
      try {
        const response = await client.get<{ data?: StatusData }>(`/sms/status/${messageId}`);
        failures = 0;
        if (response.data) {
          last = response.data;
          const outcome = outcomeOf(last);
          if (outcome) return { outcome, status: last };
        }
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (error.status === 429) {
          await interrupt.sleep(Math.min((error.retryAfter ?? 5) * 1000, Math.max(0, deadline - Date.now())));
        } else if (error.kind === 'network' || error.kind === 'timeout' || (error.status ?? 0) >= 500) {
          failures += 1;
          if (failures >= 3) {
            const reason = describeApiError(error, { operation: 'status', keySource, apiBase: ctx.apiBase });
            throw new CliError(
              `${reason.message} The text was handed over (message id ${messageId}); check it later with: smstunnel status ${messageId}`,
              reason.exitCode,
              { ...reason.details, messageId },
            );
          }
        } else {
          const reason = describeApiError(error, { operation: 'status', keySource, apiBase: ctx.apiBase });
          throw new CliError(
            `${reason.message} The text itself was handed over (message id ${messageId}): don't send it again.`,
            reason.exitCode,
            { ...reason.details, messageId },
          );
        }
      }
      if (Date.now() >= deadline) return { outcome: 'still-waiting', status: last };
    }
  } finally {
    interrupt.stop();
  }
}

export async function send(ctx: Context, args: string[], kind: SendKind): Promise<number> {
  const { out, options } = ctx;
  const command = kind === 'code' ? 'code' : 'send';
  const [number, ...words] = args;

  const recipient = checkRecipient(number);
  if (!recipient.ok) throw usageError(recipient.message);

  const message = await messageFrom(words);
  if (message.trim() === '') {
    throw usageError(
      kind === 'code'
        ? 'Write the text with the code, like: smstunnel code +40712345678 "Your sign-in code is 482913"'
        : 'Write the message, like: smstunnel send +40712345678 "See you at 10"',
    );
  }
  const max = kind === 'code' ? MAX_CODE_TEXT_LENGTH : MAX_TEXT_LENGTH;
  const count = characterCount(message);
  if (count > max) {
    throw usageError(
      `The text has ${count} characters; ${kind === 'code' ? 'a sign-in code text' : 'a text'} can have up to ${max}.`,
    );
  }
  if (kind === 'code' && !containsSignInCode(message)) {
    throw usageError(
      'The text must contain the code: 4 to 10 digits standing on their own (482913) or two groups of 3 joined by a dash (482-913). ' +
        'Texts without a code go through "smstunnel send".',
    );
  }

  let country: string | undefined;
  if (typeof options.country === 'string') {
    const checked = checkCountryCode(options.country);
    if (!checked.ok) throw usageError(checked.message);
    country = checked.value;
  }

  const wait = options.wait === true;
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  if (typeof options.timeout === 'string') {
    const parsed = parseSeconds(options.timeout);
    if (parsed === undefined) throw usageError('--timeout takes a number of seconds, like --timeout 60.');
    timeoutSeconds = parsed;
  }
  if (typeof options.timeout === 'string' && !wait) {
    throw usageError('--timeout goes with --wait.');
  }

  const { key, source } = requireKey(ctx);
  const client = clientFor(ctx, key);

  let device: Device | undefined;
  if (typeof options.phone === 'string') {
    device = await resolvePhone(ctx, client, source, options.phone, command);
  }

  // Only the fields SMSTunnel takes: it refuses any other with 400.
  const body: Record<string, string> = { to: recipient.value, message };
  if (device) body.deviceId = device.id;
  if (country) body.defaultCountryCode = country;

  const response = await call(ctx, command, source, () =>
    client.post<SendResponse>(kind === 'code' ? '/sms/send-2fa' : '/sms/send', body),
  );
  const messageId = response.messageId ?? response.data?.messageId;
  if (!messageId) {
    throw new CliError(
      `SMSTunnel took the text but sent back no message id. Check the Messages page in your dashboard (${DASHBOARD_URL}) before you send it again.`,
      EXIT.UNEXPECTED,
    );
  }
  const queued = Boolean(response.queued ?? response.data?.queued);
  const branded = Boolean(response.data?.branded);
  const parts = smsParts(message).parts;

  const summary = {
    messageId,
    queued,
    branded,
    parts,
    remaining: response.data?.remaining ?? null,
  };

  if (!wait) {
    if (ctx.json) {
      out.data({ ...summary, result: queued ? 'queued' : 'handed-over', status: null });
      return EXIT.OK;
    }
    out.line(
      queued
        ? 'Queued: none of your phones is online right now. The text goes out when your phone is back online (within 3 days).'
        : 'Handed to your phone, which sends it from your number.',
    );
    out.line(`Message id: ${messageId}${parts > 1 ? ` (${parts} parts)` : ''}. Check it with: smstunnel status ${messageId}`);
    if (branded) out.line('Free plan: a short line was added to this text.');
    return EXIT.OK;
  }

  if (!ctx.json) {
    out.note(
      queued
        ? `Queued (message id ${messageId}): none of your phones is online right now. Waiting up to ${timeoutSeconds} s… (Ctrl+C stops waiting; the text still goes out)`
        : `Handed to your phone (message id ${messageId}). Waiting up to ${timeoutSeconds} s for it to be sent… (Ctrl+C stops waiting)`,
    );
  }

  const { outcome, status } = await waitForPhone(ctx, client, source, messageId, timeoutSeconds);

  if (ctx.json) {
    out.data({ ...summary, result: outcome, status: status ?? null });
  } else {
    switch (outcome) {
      case 'sent':
        out.line(`Sent by your phone${status?.sentAt ? ` at ${formatLocal(status.sentAt)}` : ''}. Message id: ${messageId}`);
        if (branded) out.line('Free plan: a short line was added to this text.');
        break;
      case 'unconfirmed':
        out.line(
          `Not confirmed by your phone: it handed the text to the SIM, so it was most likely sent. Don't send it again. Message id: ${messageId}`,
        );
        break;
      case 'failed':
        out.note(`Not sent: ${status?.errorMessage || 'your phone could not send it'}. Message id: ${messageId}`);
        break;
      case 'still-waiting':
        out.note(
          `Still waiting for your phone after ${timeoutSeconds} s${queued ? ' (it is offline)' : ''}. ` +
            `The text goes out when your phone is back online; don't send it again. Check it later with: smstunnel status ${messageId}`,
        );
        break;
      case 'interrupted':
        out.note(`Stopped waiting. The text is still on its way; check it with: smstunnel status ${messageId}`);
        break;
    }
  }

  switch (outcome) {
    case 'sent':
    case 'unconfirmed':
      return EXIT.OK;
    case 'failed':
      return EXIT.TEXT_FAILED;
    case 'still-waiting':
      return EXIT.STILL_WAITING;
    default:
      return EXIT.INTERRUPTED;
  }
}
