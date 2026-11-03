import { ApiError } from '../api';
import { EXIT } from '../constants';
import { call, clientFor, Context, Interrupt, pollIntervalMs, requireKey, resolvePhone } from '../context';
import { CliError, describeApiError, usageError } from '../errors';
import { formatLocal, parseSeconds, parseSince } from '../time';

export interface ReceivedMessage {
  id: string;
  sender: string;
  message: string | null;
  isEncrypted?: boolean;
  receivedAt: string;
  deviceId?: string;
  deviceName?: string;
}

interface ReceivedData {
  messages: ReceivedMessage[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/** One line per text: time, sender, the phone that got it, the words (new lines shown as " / "). */
export function receivedLine(message: ReceivedMessage): string {
  const words = message.isEncrypted || message.message === null ? '[encrypted]' : message.message.replace(/\s*\r?\n\s*/g, ' / ');
  const phone = message.deviceName ? `  (${message.deviceName})` : '';
  return `${formatLocal(message.receivedAt)}  ${message.sender}${phone}  ${words}`;
}

const oldestFirst = (a: ReceivedMessage, b: ReceivedMessage) =>
  new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime();

const WATCH_OVERLAP_MS = 5 * 60_000;
const MAX_REMEMBERED = 5000;

export async function received(ctx: Context, args: string[]): Promise<number> {
  if (args.length > 0) throw usageError('"smstunnel received" takes no arguments; use --since, --from, --phone or --limit.');
  const { out, options } = ctx;

  let since: Date | undefined;
  if (typeof options.since === 'string') {
    since = parseSince(options.since);
    if (!since) {
      throw usageError('--since takes a date (2026-11-03 or 2026-11-03T08:00:00Z) or a span back from now (30m, 2h, 1d).');
    }
  }
  let limit = 20;
  if (typeof options.limit === 'string') {
    if (!/^\d+$/.test(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 100) {
      throw usageError('--limit takes a number from 1 to 100.');
    }
    limit = Number(options.limit);
  }
  const watch = options.watch === true;
  let intervalSeconds = 10;
  if (typeof options.interval === 'string') {
    const parsed = parseSeconds(options.interval);
    if (parsed === undefined || parsed < 3) throw usageError('--interval takes a number of seconds, at least 3.');
    intervalSeconds = parsed;
  }
  if (typeof options.interval === 'string' && !watch) throw usageError('--interval goes with --watch.');
  const from = typeof options.from === 'string' ? options.from.trim() : undefined;

  const { key, source } = requireKey(ctx);
  const client = clientFor(ctx, key);
  const deviceId =
    typeof options.phone === 'string' ? (await resolvePhone(ctx, client, source, options.phone, 'received')).id : undefined;

  const fetchPage = (after: Date | undefined) =>
    client.get<{ data?: ReceivedData }>('/sms/received', {
      limit,
      since: after?.toISOString(),
      phone: from,
      deviceId,
    });

  let lastPoll = Date.now();
  const first = await call(ctx, 'received', source, () => fetchPage(since));
  const data: ReceivedData = first.data ?? { messages: [], total: 0, page: 1, limit, hasMore: false };
  const messages = [...data.messages].sort(oldestFirst);

  if (!watch) {
    if (ctx.json) {
      out.data(data);
      return EXIT.OK;
    }
    if (messages.length === 0) {
      out.line(
        `No received texts${since ? ` since ${formatLocal(since)}` : ''}. Your phone syncs received texts only after ` +
          '"Sync received texts" is turned on in the SMSTunnel app, and only those that arrive after that.',
      );
      return EXIT.OK;
    }
    for (const message of messages) out.line(receivedLine(message));
    if (data.hasMore) {
      out.note(`Showing the latest ${messages.length} of ${data.total}. Use --limit (up to 100) or --since to see others.`);
    }
    return EXIT.OK;
  }

  // --watch: what is there, then each new text as it arrives, until Ctrl+C.
  const seen = new Set<string>();
  const show = (message: ReceivedMessage) => {
    seen.add(message.id);
    if (seen.size > MAX_REMEMBERED) {
      const oldest = seen.values().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    if (ctx.json) out.jsonLine(message);
    else out.line(receivedLine(message));
  };
  messages.forEach(show);
  if (!ctx.json) out.note(`Watching for new texts every ${intervalSeconds} s… (Ctrl+C stops)`);

  const interrupt = new Interrupt().start();
  const interval = pollIntervalMs(ctx.env, intervalSeconds * 1000);
  let delay = interval;
  try {
    for (;;) {
      await interrupt.sleep(delay);
      if (interrupt.interrupted) return EXIT.OK;
      const pollStart = Date.now();
      // A margin back in time, so a text synced late is not missed; ids already shown are skipped.
      const after = new Date(Math.max(since?.getTime() ?? 0, lastPoll - WATCH_OVERLAP_MS));
      try {
        const page = await fetchPage(after);
        lastPoll = pollStart;
        delay = interval;
        const fresh = (page.data?.messages ?? []).filter((message) => !seen.has(message.id)).sort(oldestFirst);
        fresh.forEach(show);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        delay = watchErrorDelay(ctx, error, source, interval);
      }
    }
  } finally {
    interrupt.stop();
  }
}

/** How long to wait after a failed poll; throws when watching can't go on (401, 403…). */
function watchErrorDelay(ctx: Context, error: ApiError, source: 'env' | 'stored', interval: number): number {
  if (error.status === 429) {
    return Math.max(interval, (error.retryAfter ?? 30) * 1000);
  }
  const reason = describeApiError(error, { operation: 'received', keySource: source, apiBase: ctx.apiBase });
  if (error.kind === 'network' || error.kind === 'timeout' || (error.status ?? 0) >= 500) {
    const next = Math.min(60_000, interval * 2);
    ctx.out.note(`${reason.message} Trying again in ${Math.round(next / 1000)} s.`);
    return next;
  }
  throw new CliError(reason.message, reason.exitCode, reason.details);
}
