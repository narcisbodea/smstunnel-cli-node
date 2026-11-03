const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/**
 * --since: an ISO date or time ("2026-11-03", "2026-11-03T08:00:00Z") or a span back from now
 * ("90s", "30m", "2h", "1d", "1w"). Returns undefined when it is neither.
 */
export function parseSince(input: string, now: Date = new Date()): Date | undefined {
  const value = input.trim();
  const span = /^(\d+)\s*([smhdw])$/i.exec(value);
  if (span) {
    const amount = Number(span[1]);
    const unit = UNIT_MS[span[2].toLowerCase()];
    return new Date(now.getTime() - amount * unit);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-03 09:41" in this computer's time zone. */
export function formatLocal(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function formatAgo(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return 'never';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

/** Whole seconds from a --timeout or --interval value; undefined when it isn't a positive number. */
export function parseSeconds(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  const value = input.trim().replace(/s$/i, '');
  if (!/^\d+(\.\d+)?$/.test(value)) return undefined;
  const seconds = Number(value);
  return seconds > 0 ? seconds : undefined;
}
