import { DASHBOARD_URL, DEFAULT_API_BASE, EXIT, PLAY_URL } from '../constants';
import { call, clientFor, Context, DevicesData, maskKey } from '../context';
import { usageError } from '../errors';
import { readSecret } from '../prompt';
import { KEY_PATTERN, removeKey, saveKey } from '../store';

export async function login(ctx: Context, args: string[]): Promise<number> {
  if (args.length > 0) {
    throw usageError(
      'Don\'t put the key on the command line: it would stay in your shell history. Run "smstunnel login" and paste it when asked, or pipe it in: echo "$KEY" | smstunnel login',
    );
  }
  const { out, env } = ctx;
  if ((env.SMSTUNNEL_API_KEY || '').trim() !== '') {
    out.note('Note: SMSTUNNEL_API_KEY is set, so it keeps being used instead of the key you save now.');
  }
  if (ctx.apiBase !== DEFAULT_API_BASE) {
    out.note(`Signing in at ${ctx.apiBase}`);
  }

  const key = await readSecret(`Paste your SMSTunnel API key (${DASHBOARD_URL} → Apps → Add an app) and press Enter: `);
  if (key === '') throw usageError('No key was given.');
  if (!KEY_PATTERN.test(key)) {
    throw usageError('That does not look like an SMSTunnel API key (they look like sk_live_…).');
  }

  // Checked before it is saved: a key SMSTunnel refuses is never stored.
  const client = clientFor(ctx, key);
  const response = await call(ctx, 'login', 'typed', () => client.get<{ data?: DevicesData }>('/devices'));
  const devices = response.data?.devices ?? [];

  const apiBaseToSave = ctx.apiBase !== DEFAULT_API_BASE ? ctx.apiBase : undefined;
  const saved = saveKey(key, apiBaseToSave, env);

  if (ctx.json) {
    out.data({
      signedIn: true,
      key: maskKey(key),
      keyStore: saved.kind,
      savedIn: saved.label,
      apiBase: ctx.apiBase,
      phones: devices,
    });
  } else {
    out.line(`Signed in with ${maskKey(key)}. The key is saved in ${saved.label}.`);
    if (devices.length === 0) {
      out.line(`No phones are linked yet: install the SMSTunnel app on your Android phone and sign in (${PLAY_URL}).`);
    } else {
      out.line(`Your phones: ${devices.map((d) => `${d.name} (${d.isOnline ? 'online' : 'offline'})`).join(', ')}`);
    }
  }
  if (saved.kind === 'file') {
    out.note(
      `Warning: ${saved.fallbackReason ?? 'no system keychain was found'}, so the key is saved in a file that only your ` +
        `user account can read (${saved.label}). Anyone who can sign in as you can read it; "smstunnel logout" removes it.`,
    );
  }
  return EXIT.OK;
}

export async function logout(ctx: Context, args: string[]): Promise<number> {
  if (args.length > 0) throw usageError('"smstunnel logout" takes no arguments.');
  const { out, env } = ctx;
  const { removedFrom } = removeKey(env);
  if (ctx.json) {
    out.data({ signedOut: true, removedFrom });
  } else if (removedFrom.length > 0) {
    out.line(
      `Signed out: the key was removed from ${removedFrom.join(' and ')}. ` +
        'The key itself keeps working until you deactivate or delete it in your dashboard (Apps).',
    );
  } else {
    out.line('There was no saved key on this computer.');
  }
  if ((env.SMSTUNNEL_API_KEY || '').trim() !== '') {
    out.note('Note: SMSTUNNEL_API_KEY is still set in your environment; unset it too.');
  }
  return EXIT.OK;
}
