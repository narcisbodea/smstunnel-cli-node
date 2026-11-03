import { EXIT } from '../constants';
import { call, clientFor, Context, requireKey, StatusData } from '../context';
import { usageError } from '../errors';
import { formatLocal } from '../time';

/** One sentence on where a text is now. */
export function describeStatus(status: StatusData): string {
  if (status.unconfirmed === true || status.deliveryStatus === 'unconfirmed') {
    return "Not confirmed by your phone: it handed the text to the SIM, so it was most likely sent. Don't send it again.";
  }
  switch (status.status) {
    case 'sent':
      return `Sent by your phone${status.sentAt ? ` at ${formatLocal(status.sentAt)}` : ''}.`;
    case 'delivered':
      return `Delivered${status.deliveredAt ? ` at ${formatLocal(status.deliveredAt)}` : ''}.`;
    case 'failed':
      return `Not sent: ${status.errorMessage || 'your phone could not send it'}.`;
    case 'pending':
      return 'Waiting for your phone to send it. If your phone is offline, the text goes out when it is back online (within 3 days).';
    default:
      return `Status: ${status.status}.`;
  }
}

export async function status(ctx: Context, args: string[]): Promise<number> {
  if (args.length !== 1) throw usageError('Give one message id: smstunnel status <message-id>');
  const id = args[0].trim();
  if (!/^[0-9a-f]{24}$/i.test(id)) {
    throw usageError('A message id has 24 characters, 0-9 and a-f: the one "smstunnel send" printed.');
  }
  const { key, source } = requireKey(ctx);
  const client = clientFor(ctx, key);
  const response = await call(ctx, 'status', source, () => client.get<{ data?: StatusData }>(`/sms/status/${id}`));
  const data = response.data;
  if (!data) throw usageError('SMSTunnel sent back no status.');
  if (ctx.json) {
    ctx.out.data(data);
    return EXIT.OK;
  }
  ctx.out.line(describeStatus(data));
  if (data.phoneNumber) ctx.out.line(`To: ${data.phoneNumber}`);
  ctx.out.line(`Message id: ${data.id ?? id}`);
  return EXIT.OK;
}
