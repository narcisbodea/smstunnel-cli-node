// End to end against the mock API (mock-server.mjs): the built CLI runs as a child process.
//   npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startMockServer, KEYS, PHONES, SPECIAL } from './mock-server.mjs';
import { cleanEnv, runCli, tempConfig } from './run-cli.mjs';

let mock;
let config;

before(async () => {
  mock = await startMockServer();
  config = tempConfig();
});

after(async () => {
  await mock?.close();
  config?.remove();
});

/** Runs the CLI against the mock with the full key in SMSTUNNEL_API_KEY (key: null for none). */
const cli = (args, { key = KEYS.full, env = {}, ...rest } = {}) =>
  runCli([...args, '--api-base', mock.apiBase], {
    env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: key === null ? undefined : key, SMSTUNNEL_POLL_INTERVAL_MS: '100', ...env }),
    ...rest,
  });

const lastRequest = (path, method = 'POST') => [...mock.state.requests].reverse().find((r) => r.path === path && r.method === method);
const sendsSoFar = () => mock.state.requests.filter((r) => r.path === '/api/v1/sms/send' || r.path === '/api/v1/sms/send-2fa').length;

test('--version, --help and an unknown command', async () => {
  const version = await runCli(['--version'], { env: cleanEnv() });
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url))).version);
  const help = await runCli(['--help'], { env: cleanEnv() });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /One number per text/);
  assert.match(help.stdout, /Exit codes:/);
  const sendHelp = await runCli(['send', '--help'], { env: cleanEnv() });
  assert.match(sendHelp.stdout, /--wait/);
  const unknown = await runCli(['blast'], { env: cleanEnv() });
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown command "blast"/);
  const noCommand = await runCli([], { env: cleanEnv() });
  assert.equal(noCommand.code, 2);
});

test('no key: exit 3 and how to get one', async () => {
  const result = await cli(['phones'], { key: null });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /smstunnel login/);
  assert.match(result.stderr, /dashboard\.smstunnel\.io → Apps → Add an app/);
});

test('login: a refused key is never saved', async () => {
  const result = await cli(['login'], { key: null, input: `${KEYS.refused}\n` });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /refused the API key/);
  assert.equal(fs.existsSync(config.configFile), false);
});

test('login: the key goes in through stdin, never as an argument', async () => {
  const result = await cli(['login', KEYS.full], { key: null });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /shell history/);
  const empty = await cli(['login'], { key: null, input: '' });
  assert.equal(empty.code, 2);
});

test('login, then commands use the saved key and API address; logout removes them', async () => {
  const login = await runCli(['login', '--api-base', mock.apiBase], { env: cleanEnv(config.env), input: `${KEYS.full}\n` });
  assert.equal(login.code, 0, login.stderr);
  assert.match(login.stdout, /Signed in with sk_live_aa…aaaa\. The key is saved in /);
  assert.match(login.stdout, /Your phones: Desk phone \(online\), Spare phone \(offline\)/);
  assert.match(login.stderr, /Warning: SMSTUNNEL_KEY_STORE=file, so the key is saved in a file/);
  assert.doesNotMatch(login.stdout + login.stderr, new RegExp(KEYS.full));
  const saved = JSON.parse(fs.readFileSync(config.configFile, 'utf8'));
  assert.deepEqual(saved, { keyStore: 'file', apiBase: mock.apiBase, apiKey: KEYS.full });
  if (process.platform !== 'win32') assert.equal(fs.statSync(config.configFile).mode & 0o777, 0o600);

  // No --api-base and no SMSTUNNEL_API_KEY: both come from the login.
  const phones = await runCli(['phones'], { env: cleanEnv(config.env) });
  assert.equal(phones.code, 0, phones.stderr);
  assert.match(phones.stdout, /Desk phone/);

  // SMSTUNNEL_API_KEY wins over the saved key.
  const env = await runCli(['phones'], { env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: KEYS.refused }) });
  assert.equal(env.code, 3);
  assert.match(env.stderr, /SMSTUNNEL_API_KEY/);

  const logout = await runCli(['logout'], { env: cleanEnv(config.env) });
  assert.equal(logout.code, 0);
  assert.match(logout.stdout, /Signed out: the key was removed from /);
  assert.equal(fs.existsSync(config.configFile), false);
  const after = await runCli(['phones'], { env: cleanEnv(config.env) });
  assert.equal(after.code, 3);
});

test('phones: table and JSON', async () => {
  const table = await cli(['phones']);
  assert.equal(table.code, 0);
  assert.match(table.stdout, /^ID\s+NAME\s+STATUS\s+LAST SEEN/m);
  assert.match(table.stdout, /a1a1a1a1a1a1a1a1a1a1a1a1  Desk phone\s+online\s+now/);
  assert.match(table.stdout, /2 of 4 online/);
  const json = await cli(['phones', '--json']);
  assert.equal(json.code, 0);
  const data = JSON.parse(json.stdout);
  assert.equal(data.total, 4);
  assert.equal(data.devices[1].name, 'Spare phone');
});

test('send: one text to one number, with only the fields SMSTunnel takes', async () => {
  const result = await cli(['send', '+40712345678', 'Your', 'order', 'is', 'ready']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Handed to your phone, which sends it from your number\./);
  assert.match(result.stdout, /Message id: [0-9a-f]{24}\. Check it with: smstunnel status [0-9a-f]{24}/);
  assert.deepEqual(lastRequest('/api/v1/sms/send').body, { to: '+40712345678', message: 'Your order is ready' });
});

test('send --phone by name or id, --country', async () => {
  const byName = await cli(['send', '0712345678', 'Hi', '--phone', 'desk PHONE', '--country', '+40']);
  assert.equal(byName.code, 0, byName.stderr);
  assert.deepEqual(lastRequest('/api/v1/sms/send').body, {
    to: '0712345678',
    message: 'Hi',
    deviceId: PHONES[0].id,
    defaultCountryCode: '+40',
  });
  const byId = await cli(['send', '+40712345678', 'Hi', '--phone', PHONES[2].id]);
  assert.equal(byId.code, 0);
  assert.equal(lastRequest('/api/v1/sms/send').body.deviceId, PHONES[2].id);
});

test('send refuses before calling SMSTunnel: lists, bad phone names, bad country codes, long texts', async () => {
  const before = sendsSoFar();
  for (const [args, pattern] of [
    [['send', '+40712345678,+40722333444', 'Hi'], /^One number per text\.$/m],
    [['send', '+40712345678;+40722333444', 'Hi'], /^One number per text\.$/m],
    [['send', '+40712345678 +40722333444', 'Hi'], /^One number per text\.$/m],
    [['send', '0712345678 0722333444', 'Hi'], /more than one number\. One number per text\./],
    [['send', 'mom', 'Hi'], /not a phone number/],
    [['send', '+40712345678', 'Hi', '--phone', 'Twin'], /Several of your phones are called "Twin"/],
    [['send', '+40712345678', 'Hi', '--phone', 'Kitchen'], /No phone called "Kitchen"\. Your phones: "Desk phone", "Spare phone", "Twin", "Twin"/],
    [['send', '+40712345678', 'Hi', '--country', 'RO'], /country calling code in digits/],
    [['send', '+40712345678', 'x'.repeat(1601)], /The text has 1601 characters; a text can have up to 1600\./],
    [['send', '+40712345678'], /Write the message/],
    [['send', '+40712345678', 'Hi', '--timeout', '5'], /--timeout goes with --wait/],
    [['send'], /Give the number to text/],
  ]) {
    const result = await cli(args);
    assert.equal(result.code, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.match(result.stderr, pattern, args.join(' '));
  }
  assert.equal(sendsSoFar(), before, 'nothing was sent');
  const wrongOption = await cli(['phones', '--wait']);
  assert.equal(wrongOption.code, 2);
  assert.match(wrongOption.stderr, /--wait is not an option of "smstunnel phones"/);
});

test('send reads the text from stdin when it is piped', async () => {
  const result = await cli(['send', '+40712345678'], { input: 'Backup finished\n' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(lastRequest('/api/v1/sms/send').body.message, 'Backup finished');
  const dash = await cli(['send', '+40712345678', '-'], { input: 'Line one\nLine two\n\n' });
  assert.equal(dash.code, 0);
  assert.equal(lastRequest('/api/v1/sms/send').body.message, 'Line one\nLine two');
});

test('send --wait: sent by the phone', async () => {
  const result = await cli(['send', '+40712345678', 'See you at 10', '--wait']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /Handed to your phone \(message id [0-9a-f]{24}\)\. Waiting up to 120 s/);
  assert.match(result.stdout, /^Sent by your phone at \d{4}-\d{2}-\d{2} \d{2}:\d{2}\. Message id: [0-9a-f]{24}$/m);
});

test('send --wait --json: the final status as JSON', async () => {
  const result = await cli(['send', '+40712345678', 'JSON please', '--wait', '--json']);
  assert.equal(result.code, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.result, 'sent');
  assert.equal(data.queued, false);
  assert.equal(data.status.deliveryStatus, 'sent');
  assert.match(data.messageId, /^[0-9a-f]{24}$/);
});

test('send --wait: failed, exit 8', async () => {
  const result = await cli(['send', '+40712345678', 'FAILME please', '--wait']);
  assert.equal(result.code, 8);
  assert.match(result.stderr, /Not sent: Generic failure \(the SIM refused it\)\. Message id: [0-9a-f]{24}/);
});

test('send --wait: not confirmed by the phone counts as sent, with the warning, exit 0', async () => {
  const result = await cli(['send', '+40712345678', 'UNCONFIRMED text', '--wait']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Not confirmed by your phone: .*most likely sent\. Don't send it again\./);
});

test('send --wait waits out a 429 on the status check', async () => {
  const result = await cli(['send', '+40712345678', 'STATUS429ONCE text', '--wait']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Sent by your phone/);
});

test('send --wait with a key that may not check status: exit 4, and the text was handed over', async () => {
  const result = await cli(['send', '+40712345678', 'STATUS403 text', '--wait']);
  assert.equal(result.code, 4);
  assert.match(result.stderr, /may not check whether texts went out .* The text itself was handed over \(message id [0-9a-f]{24}\): don't send it again\./);
});

test('send to an offline phone: queued; --wait gives up with exit 9 and says not to resend', async () => {
  const queued = await cli(['send', '+40712345678', 'Hi', '--phone', 'Spare phone']);
  assert.equal(queued.code, 0);
  assert.match(queued.stdout, /^Queued: none of your phones is online right now\. The text goes out when your phone is back online \(within 3 days\)\.$/m);
  const json = await cli(['send', '+40712345678', 'Hi', '--phone', 'Spare phone', '--json']);
  assert.equal(JSON.parse(json.stdout).result, 'queued');
  const waited = await cli(['send', '+40712345678', 'Hi', '--phone', 'Spare phone', '--wait', '--timeout', '1']);
  assert.equal(waited.code, 9);
  assert.match(waited.stderr, /Still waiting for your phone after 1 s \(it is offline\)\. .*don't send it again\. Check it later with: smstunnel status [0-9a-f]{24}/);
});

test('429 with Retry-After: too many requests, wait 7 seconds, exit 6', async () => {
  const result = await cli(['send', SPECIAL.rateLimited, 'Hi']);
  assert.equal(result.code, 6);
  assert.equal(result.stderr.trim(), 'Too many texts in a minute: SMSTunnel takes up to 30 send requests a minute. Try again in 7 seconds.');
});

test('429 without Retry-After: the allowance, in SMSTunnel words, exit 6', async () => {
  const result = await cli(['send', SPECIAL.allowanceUsed, 'Hi']);
  assert.equal(result.code, 6);
  assert.equal(result.stderr.trim(), "You've sent today's 25 texts on the Free plan. More go out tomorrow.");
});

test('403 for the plan, 400 with a list, 500: exit 4, 2 and 7', async () => {
  const plan = await cli(['send', SPECIAL.planRefused, 'Hi']);
  assert.equal(plan.code, 4);
  assert.match(plan.stderr, /Professional or Enterprise plan/);
  const validation = await cli(['send', SPECIAL.validation, 'Hi']);
  assert.equal(validation.code, 2);
  assert.match(validation.stderr, /Phone number must contain 7-25 characters; second problem/);
  const server = await cli(['send', SPECIAL.serverProblem, 'Hi']);
  assert.equal(server.code, 7);
  assert.match(server.stderr, /may or may not have been taken/);
});

test('a connection that breaks after the text left: it may have gone out, exit 7', async () => {
  const result = await cli(['send', SPECIAL.connectionDrops, 'Hi']);
  assert.equal(result.code, 7);
  assert.match(result.stderr, /may have gone out\. Check the Messages page/);
});

test('errors as JSON on stderr with --json', async () => {
  const result = await cli(['phones', '--json'], { key: KEYS.refused });
  assert.equal(result.code, 3);
  assert.equal(result.stdout, '');
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.exitCode, 3);
  assert.equal(error.status, 401);
  assert.match(error.message, /refused the API key/);
});

test('code: the text must carry the code; it goes to send-2fa', async () => {
  const before = sendsSoFar();
  const noCode = await cli(['code', '+40712345678', 'Hello there']);
  assert.equal(noCode.code, 2);
  assert.match(noCode.stderr, /must contain the code/);
  const tooLong = await cli(['code', '+40712345678', `Code 482913 ${'x'.repeat(320)}`]);
  assert.equal(tooLong.code, 2);
  assert.match(tooLong.stderr, /a sign-in code text can have up to 320/);
  assert.equal(sendsSoFar(), before);
  const result = await cli(['code', '+40712345678', 'Your', 'sign-in', 'code', 'is', '482913', '--wait']);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Sent by your phone/);
  assert.deepEqual(lastRequest('/api/v1/sms/send-2fa').body, { to: '+40712345678', message: 'Your sign-in code is 482913' });
});

test('status: sent, unknown id, malformed id', async () => {
  const sent = await cli(['send', '+40712345678', 'Status check', '--wait', '--json']);
  const { messageId } = JSON.parse(sent.stdout);
  const result = await cli(['status', messageId]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^Sent by your phone at .*\.\nTo: \+40712345678\nMessage id: [0-9a-f]{24}\n$/);
  const json = await cli(['status', messageId, '--json']);
  assert.equal(JSON.parse(json.stdout).status, 'sent');
  const unknown = await cli(['status', 'ffffffffffffffffffffffff']);
  assert.equal(unknown.code, 5);
  assert.equal(unknown.stderr.trim(), 'No text with that id for this key.');
  const malformed = await cli(['status', 'abc']);
  assert.equal(malformed.code, 2);
});

test('received: oldest first; --since, --from, --limit go in the query', async () => {
  const result = await cli(['received']);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\+40711111111  \(Desk phone\)  Earlier reply$/);
  assert.match(lines[1], /\+40722222222  \(Desk phone\)  See you \/ at 10$/);
  const since = await cli(['received', '--since', '1h', '--from', '+40722222222', '--limit', '5']);
  assert.equal(since.code, 0);
  const query = lastRequest('/api/v1/sms/received', 'GET').query;
  assert.equal(query.limit, '5');
  assert.equal(query.phone, '+40722222222');
  assert.ok(Math.abs(new Date(query.since).getTime() - (Date.now() - 3600_000)) < 60_000);
  assert.equal(since.stdout.trim().split('\n').length, 1);
  const bad = await cli(['received', '--since', 'yesterday']);
  assert.equal(bad.code, 2);
  const badLimit = await cli(['received', '--limit', '0']);
  assert.equal(badLimit.code, 2);
});

test('received with a key that may not read them: exit 4 and how to allow it', async () => {
  const result = await cli(['received'], { key: KEYS.sendOnly });
  assert.equal(result.code, 4);
  assert.match(result.stderr, /may not read received texts/);
  assert.match(result.stderr, /allow reading received messages/);
});

test('received --watch prints new texts as they arrive', async () => {
  let added = false;
  const result = await cli(['received', '--watch', '--interval', '3'], {
    timeoutMs: 15_000,
    onStdout: (stdout, child) => {
      if (!added && stdout.includes('See you / at 10')) {
        added = true;
        mock.addReceived({ id: 'abababababababababababab', sender: '+40733333333', message: 'New reply while watching' });
      }
      if (stdout.includes('New reply while watching')) child.kill();
    },
  });
  assert.ok(added);
  assert.match(result.stdout, /See you \/ at 10\n.*\+40733333333  \(Desk phone\)  New reply while watching/);
  assert.equal((result.stdout.match(/New reply while watching/g) ?? []).length, 1, 'shown once');
  assert.match(result.stderr, /Watching for new texts every 3 s/);
});

test('usage', async () => {
  const result = await cli(['usage']);
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout,
    'Plan: free\nTexts today: 3 used, 22 left (of 25)\nTexts this month: 40 used, 460 left (of 500)\n' +
      'Texts with the free line today: 0 used, 25 left (of 25)\nSign-in codes today: 1 used, 19 left (of 20)\n',
  );
});

test('API addresses that are not SMSTunnel, or not reachable: exit 2 or 7', async () => {
  const http = await runCli(['phones', '--api-base', 'http://example.com/api/v1'], {
    env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: KEYS.full }),
  });
  assert.equal(http.code, 2);
  assert.match(http.stderr, /https:\/\//);
  const redirect = await runCli(['phones', '--api-base', mock.apiBase.replace('/api/v1', '/redirect-base/api/v1')], {
    env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: KEYS.full }),
  });
  assert.equal(redirect.code, 7);
  assert.match(redirect.stderr, /redirect/);
  const html = await runCli(['phones', '--api-base', mock.apiBase.replace('/api/v1', '/html-base/api/v1')], {
    env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: KEYS.full }),
  });
  assert.equal(html.code, 7);
  assert.match(html.stderr, /not the SMSTunnel API/);
  const down = await runCli(['phones', '--api-base', 'http://127.0.0.1:9/api/v1'], {
    env: cleanEnv({ ...config.env, SMSTUNNEL_API_KEY: KEYS.full }),
  });
  assert.equal(down.code, 7);
  assert.match(down.stderr, /Could not reach SMSTunnel at 127\.0\.0\.1:9/);
});

test('every call: the key only in X-API-Key, never in a URL; never send-bulk; a User-Agent', () => {
  assert.ok(mock.state.requests.length > 20);
  for (const request of mock.state.requests) {
    assert.doesNotMatch(request.url, /sk_live/);
    assert.notEqual(request.path, '/api/v1/sms/send-bulk');
    assert.match(request.headers['user-agent'], /^smstunnel-cli\/\d+\.\d+\.\d+ \(node v\d+/);
    assert.equal(request.headers.authorization, undefined);
  }
});
