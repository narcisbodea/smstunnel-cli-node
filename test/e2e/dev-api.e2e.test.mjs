// End to end against a LOCAL SMSTunnel API (never smstunnel.io) with throwaway keys and a fake phone.
// Skipped unless these are set (keys only in the environment, never in this repo):
//   SMSTUNNEL_E2E_API_BASE        e.g. http://127.0.0.1:3121/api/v1 (localhost only)
//   SMSTUNNEL_E2E_KEY             a key with sms:send, sms:read and sms:inbox
//   SMSTUNNEL_E2E_SEND_ONLY_KEY   a key without sms:inbox (optional)
//   SMSTUNNEL_E2E_ONLINE_PHONE    name or id of a phone a fake phone keeps online
//   SMSTUNNEL_E2E_OFFLINE_PHONE   id or name of a phone that stays offline
//   SMSTUNNEL_E2E_NUMBER          the test recipient (default +14155550123)
//   SMSTUNNEL_E2E_EXPECT_RECEIVED a received text the fake phone delivered before the run (optional)
//   SMSTUNNEL_E2E_IDEMPOTENCY_KEY an Idempotency-Key to use (optional; default: a new one per run)
// It sends exactly 4 texts: one sent, one queued, one sign-in code, one sent twice with one Idempotency-Key.
//   npm run test:dev-api
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEnv, runCli, tempConfig } from './run-cli.mjs';

const E = process.env;
const apiBase = E.SMSTUNNEL_E2E_API_BASE;
const key = E.SMSTUNNEL_E2E_KEY;
const number = E.SMSTUNNEL_E2E_NUMBER || '+14155550123';
const skip = !apiBase || !key ? 'set SMSTUNNEL_E2E_API_BASE and SMSTUNNEL_E2E_KEY to run against a local API' : false;
if (apiBase && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(apiBase)) {
  throw new Error('SMSTUNNEL_E2E_API_BASE must be a local API (http://127.0.0.1:PORT/api/v1), never smstunnel.io');
}

let config;
before(() => {
  config = tempConfig();
});
after(() => config?.remove());

const run = (args, { withKey = true, env = {}, ...rest } = {}) =>
  runCli([...args, '--api-base', apiBase], {
    env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: withKey ? key : undefined, ...env }),
    ...rest,
  });

let sentId;

test('login with the key on stdin, saved in the file store', { skip }, async () => {
  const result = await run(['login'], { withKey: false, input: `${key}\n` });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Signed in with sk_live_/);
  if (E.SMSTUNNEL_E2E_ONLINE_PHONE && !/^[0-9a-f]{24}$/.test(E.SMSTUNNEL_E2E_ONLINE_PHONE)) {
    assert.match(result.stdout, new RegExp(`${E.SMSTUNNEL_E2E_ONLINE_PHONE} \\(online\\)`));
  }
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(key));
});

test('phones, with the saved key', { skip }, async () => {
  const result = await run(['phones'], { withKey: false });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^ID\s+NAME\s+STATUS\s+LAST SEEN/);
  assert.match(result.stdout, /\bonline\b/);
  const json = await run(['phones', '--json']);
  const data = JSON.parse(json.stdout);
  assert.ok(Array.isArray(data.devices) && data.devices.length >= 1);
});

test('send --wait: sent by the fake phone (text 1 of 4)', { skip }, async () => {
  const args = ['send', number, 'smstunnel CLI e2e: hello from the command line', '--wait', '--timeout', '30', '--json'];
  if (E.SMSTUNNEL_E2E_ONLINE_PHONE) args.push('--phone', E.SMSTUNNEL_E2E_ONLINE_PHONE);
  const result = await run(args);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const data = JSON.parse(result.stdout);
  assert.equal(data.result, 'sent');
  assert.equal(data.status.deliveryStatus, 'sent');
  sentId = data.messageId;
});

test('status of that text', { skip }, async () => {
  assert.ok(sentId);
  const result = await run(['status', sentId]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Sent by your phone at /);
  assert.match(result.stdout, new RegExp(`To: \\${number.replace(/\s/g, '')}`));
  const unknown = await run(['status', 'ffffffffffffffffffffffff']);
  assert.equal(unknown.code, 5);
});

test('send to the offline phone: queued, --wait gives up with exit 9 (text 2 of 4)', { skip: skip || (!E.SMSTUNNEL_E2E_OFFLINE_PHONE && 'no offline phone given') }, async () => {
  const result = await run(['send', number, 'smstunnel CLI e2e: queued text', '--phone', E.SMSTUNNEL_E2E_OFFLINE_PHONE, '--wait', '--timeout', '3']);
  assert.equal(result.code, 9, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /^Queued \(message id [0-9a-f]{24}\): none of your phones is online right now/m);
  assert.match(result.stderr, /Still waiting for your phone after 3 s \(it is offline\)/);
});

test('code --wait: a sign-in code, sent (text 3 of 4)', { skip }, async () => {
  const args = ['code', number, 'Your smstunnel CLI e2e sign-in code is 482913', '--wait', '--timeout', '30'];
  if (E.SMSTUNNEL_E2E_ONLINE_PHONE) args.push('--phone', E.SMSTUNNEL_E2E_ONLINE_PHONE);
  const result = await run(args);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^Sent by your phone at /);
});

test('send twice with one --idempotency-key: one text, the same message id (text 4 of 4)', { skip }, async () => {
  const idempotencyKey = E.SMSTUNNEL_E2E_IDEMPOTENCY_KEY || `smstunnel-cli-e2e-${Date.now()}`;
  const args = ['send', number, `smstunnel CLI e2e: idempotency ${idempotencyKey}`, '--idempotency-key', idempotencyKey, '--json'];
  if (E.SMSTUNNEL_E2E_ONLINE_PHONE) args.push('--phone', E.SMSTUNNEL_E2E_ONLINE_PHONE);
  const first = await run(args);
  assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
  const again = await run(args);
  assert.equal(again.code, 0, `${again.stdout}\n${again.stderr}`);
  const a = JSON.parse(first.stdout);
  const b = JSON.parse(again.stdout);
  assert.equal(a.replayed, false);
  assert.equal(b.replayed, true);
  assert.equal(b.messageId, a.messageId);
  const other = await run(['send', number, 'smstunnel CLI e2e: another text, same key', '--idempotency-key', idempotencyKey]);
  assert.equal(other.code, 2, other.stderr);
  assert.match(other.stderr, /already used in the last 24 hours for a different text/);
});

test('received', { skip }, async () => {
  const result = await run(['received', '--since', '1d']);
  assert.equal(result.code, 0, result.stderr);
  if (E.SMSTUNNEL_E2E_EXPECT_RECEIVED) assert.match(result.stdout, new RegExp(E.SMSTUNNEL_E2E_EXPECT_RECEIVED));
  const json = await run(['received', '--json']);
  assert.equal(json.code, 0);
  const data = JSON.parse(json.stdout);
  assert.ok(Array.isArray(data.messages));
  assert.equal(typeof data.hasMore, 'boolean');
});

test('usage', { skip }, async () => {
  const result = await run(['usage']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Plan: \w+/);
  assert.match(result.stdout, /Texts today: \d+ used/);
});

test('a refused key: exit 3', { skip }, async () => {
  const result = await run(['phones'], { env: { SMSTUNNEL_API_KEY: `sk_live_${'0'.repeat(32)}` } });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /refused the API key/);
});

test('a key without sms:inbox on received: exit 4', { skip: skip || (!E.SMSTUNNEL_E2E_SEND_ONLY_KEY && 'no send-only key given') }, async () => {
  const result = await run(['received'], { env: { SMSTUNNEL_API_KEY: E.SMSTUNNEL_E2E_SEND_ONLY_KEY } });
  assert.equal(result.code, 4, result.stderr);
  assert.match(result.stderr, /may not read received texts/);
});

test('logout', { skip }, async () => {
  const result = await run(['logout'], { withKey: false });
  assert.equal(result.code, 0);
  const after = await run(['phones'], { withKey: false });
  assert.equal(after.code, 3);
});
