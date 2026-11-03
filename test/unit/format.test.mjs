import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { normalizeApiBase, maskKey } = require('../../dist/context.js');
const { outcomeOf } = require('../../dist/commands/send.js');
const { describeStatus } = require('../../dist/commands/status.js');
const { usageLines } = require('../../dist/commands/usage.js');
const { receivedLine } = require('../../dist/commands/received.js');
const { phonesTable } = require('../../dist/commands/phones.js');

test('API address: https, or http for this computer only; /api/v1 when no path', () => {
  assert.equal(normalizeApiBase('https://smstunnel.io'), 'https://smstunnel.io/api/v1');
  assert.equal(normalizeApiBase('https://smstunnel.io/api/v1/'), 'https://smstunnel.io/api/v1');
  assert.equal(normalizeApiBase('http://127.0.0.1:3121/api/v1'), 'http://127.0.0.1:3121/api/v1');
  assert.equal(normalizeApiBase('http://localhost:3121'), 'http://localhost:3121/api/v1');
  for (const bad of ['http://example.com/api/v1', 'ftp://smstunnel.io', 'https://user:pass@smstunnel.io', 'https://smstunnel.io/api/v1?x=1', 'not a url']) {
    assert.throws(() => normalizeApiBase(bad), (error) => error.exitCode === 2, bad);
  }
});

test('keys are never printed whole', () => {
  const key = `sk_live_${'0123456789abcdef'.repeat(2)}`;
  assert.equal(maskKey(key), 'sk_live_01…cdef');
  assert.equal(maskKey('sk_short'), 'sk_…');
});

test('final states while waiting', () => {
  assert.equal(outcomeOf({ status: 'pending', deliveryStatus: 'pending' }), undefined);
  assert.equal(outcomeOf({ status: 'sent', deliveryStatus: 'sent' }), 'sent');
  assert.equal(outcomeOf({ status: 'delivered' }), 'sent');
  assert.equal(outcomeOf({ status: 'failed', deliveryStatus: 'failed' }), 'failed');
  assert.equal(outcomeOf({ status: 'failed', unconfirmed: true, deliveryStatus: 'unconfirmed' }), 'unconfirmed');
  assert.equal(outcomeOf({ status: 'failed', deliveryStatus: 'unconfirmed' }), 'unconfirmed');
});

test('status sentences', () => {
  assert.match(describeStatus({ status: 'sent', sentAt: '2026-11-03T08:00:00Z' }), /^Sent by your phone at 2026-11-0\d \d{2}:00\.$/);
  assert.equal(describeStatus({ status: 'failed', errorMessage: 'No signal' }), 'Not sent: No signal.');
  assert.match(describeStatus({ status: 'failed', unconfirmed: true, deliveryStatus: 'unconfirmed' }), /most likely sent\. Don't send it again\./);
  assert.match(describeStatus({ status: 'pending' }), /^Waiting for your phone/);
});

test('usage lines, with and without the month and the free line', () => {
  const free = usageLines({
    plan: 'free',
    usage: { smsClean: 3, smsBranded: 0, twoFaClean: 1, smsCleanMonth: 40 },
    limits: { smsClean: 25, twoFaClean: 20, smsCleanPerMonth: 500, smsBrandedPerDay: 25 },
    remaining: { smsClean: 22, twoFaClean: 19, smsCleanMonth: 460, smsBranded: 25 },
  });
  assert.deepEqual(free, [
    'Plan: free',
    'Texts today: 3 used, 22 left (of 25)',
    'Texts this month: 40 used, 460 left (of 500)',
    'Texts with the free line today: 0 used, 25 left (of 25)',
    'Sign-in codes today: 1 used, 19 left (of 20)',
  ]);
  const pro = usageLines({
    plan: 'pro',
    usage: { smsClean: 0, smsBranded: 0, twoFaClean: 0 },
    limits: { smsClean: 'unlimited', twoFaClean: 'unlimited' },
    remaining: { smsClean: 'unlimited', twoFaClean: 'unlimited' },
  });
  assert.deepEqual(pro, ['Plan: pro', 'Texts today: 0 used, unlimited left', 'Sign-in codes today: 0 used, unlimited left']);
});

test('received texts on one line each', () => {
  const line = receivedLine({ id: '1', sender: '+40712345678', message: 'See you\nat 10', receivedAt: '2026-11-03T08:05:00Z', deviceName: 'Store phone' });
  assert.match(line, /^2026-11-0\d \d{2}:05  \+40712345678  \(Store phone\)  See you \/ at 10$/);
  assert.match(receivedLine({ id: '2', sender: '+1', message: null, isEncrypted: true, receivedAt: '2026-11-03T08:05:00Z' }), /\[encrypted\]$/);
});

test('phones table', () => {
  const lines = phonesTable(
    [
      { id: 'a'.repeat(24), name: 'Store phone', isOnline: true, lastSeenAt: '2026-11-03T11:59:00Z' },
      { id: 'b'.repeat(24), name: 'Old Samsung', isOnline: false, lastSeenAt: '2026-10-30T12:00:00Z' },
    ],
    new Date('2026-11-03T12:00:00Z'),
  );
  assert.equal(lines[0], 'ID                        NAME         STATUS   LAST SEEN');
  assert.equal(lines[1], `${'a'.repeat(24)}  Store phone  online   now`);
  assert.equal(lines[2], `${'b'.repeat(24)}  Old Samsung  offline  4 days ago`);
});
