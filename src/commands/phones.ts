import { EXIT, PLAY_URL } from '../constants';
import { call, clientFor, Context, Device, DevicesData, requireKey } from '../context';
import { usageError } from '../errors';
import { formatAgo } from '../time';

export function phonesTable(devices: Device[], now = new Date()): string[] {
  const rows = devices.map((device) => [
    device.id,
    device.name,
    device.isOnline ? 'online' : 'offline',
    device.isOnline ? 'now' : formatAgo(device.lastSeenAt, now),
  ]);
  const header = ['ID', 'NAME', 'STATUS', 'LAST SEEN'];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const format = (cells: string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ');
  return [format(header), ...rows.map(format)];
}

export async function phones(ctx: Context, args: string[]): Promise<number> {
  if (args.length > 0) throw usageError('"smstunnel phones" takes no arguments.');
  const { key, source } = requireKey(ctx);
  const client = clientFor(ctx, key);
  const response = await call(ctx, 'phones', source, () => client.get<{ data?: DevicesData }>('/devices'));
  const data: DevicesData = response.data ?? { devices: [], online: 0, total: 0 };
  if (ctx.json) {
    ctx.out.data(data);
    return EXIT.OK;
  }
  if (data.devices.length === 0) {
    ctx.out.line(`No phones are linked to your account yet. Install the SMSTunnel app on your Android phone and sign in: ${PLAY_URL}`);
    return EXIT.OK;
  }
  for (const line of phonesTable(data.devices)) ctx.out.line(line);
  const online = data.devices.filter((device) => device.isOnline).length;
  ctx.out.line('');
  ctx.out.line(`${online} of ${data.devices.length} online. Send from one with --phone <id or name>.`);
  return EXIT.OK;
}
