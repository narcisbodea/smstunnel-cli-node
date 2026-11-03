import { EXIT } from '../constants';
import { call, clientFor, Context, requireKey } from '../context';
import { usageError } from '../errors';

type Count = number | string | undefined | null;

interface UsageData {
  plan?: string;
  accountType?: string;
  usage?: Record<string, Count>;
  limits?: Record<string, Count>;
  remaining?: Record<string, Count>;
  enterprise?: { id: string; name: string };
}

const shown = (value: Count) => (value === undefined || value === null ? '-' : String(value));

function line(label: string, used: Count, left: Count, limit: Count): string | undefined {
  if (used === undefined && left === undefined) return undefined;
  const of = limit !== undefined && limit !== null && limit !== 'unlimited' ? ` (of ${shown(limit)})` : '';
  return `${label}: ${shown(used)} used, ${shown(left)} left${of}`;
}

export function usageLines(data: UsageData): string[] {
  const usage = data.usage ?? {};
  const limits = data.limits ?? {};
  const remaining = data.remaining ?? {};
  const lines: (string | undefined)[] = [
    `Plan: ${data.plan ?? '-'}${data.enterprise ? ` (shared with ${data.enterprise.name})` : ''}`,
    line('Texts today', usage.smsClean, remaining.smsClean, limits.smsClean),
  ];
  if (limits.smsCleanPerMonth !== undefined && limits.smsCleanPerMonth !== 'unlimited') {
    lines.push(line('Texts this month', usage.smsCleanMonth, remaining.smsCleanMonth, limits.smsCleanPerMonth));
  }
  if (limits.smsBrandedPerDay !== undefined && limits.smsBrandedPerDay !== 0) {
    lines.push(line('Texts with the free line today', usage.smsBranded, remaining.smsBranded, limits.smsBrandedPerDay));
  }
  lines.push(line('Sign-in codes today', usage.twoFaClean, remaining.twoFaClean, limits.twoFaClean));
  return lines.filter((value): value is string => value !== undefined);
}

export async function usage(ctx: Context, args: string[]): Promise<number> {
  if (args.length > 0) throw usageError('"smstunnel usage" takes no arguments.');
  const { key, source } = requireKey(ctx);
  const client = clientFor(ctx, key);
  const response = await call(ctx, 'usage', source, () => client.get<{ data?: UsageData }>('/account/usage'));
  const data = response.data ?? {};
  if (ctx.json) {
    ctx.out.data(data);
    return EXIT.OK;
  }
  for (const text of usageLines(data)) ctx.out.line(text);
  return EXIT.OK;
}
