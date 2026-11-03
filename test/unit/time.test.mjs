import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseSince, formatAgo, formatLocal, parseSeconds } = require('../../dist/time.js');

const NOW = new Date('2026-11-03T12:00:00Z');

test('--since as a span back from now', () => {
  assert.equal(parseSince('90s', NOW).toISOString(), '2026-11-03T11:58:30.000Z');
  assert.equal(parseSince('30m', NOW).toISOString(), '2026-11-03T11:30:00.000Z');
  assert.equal(parseSince('2h', NOW).toISOString(), '2026-11-03T10:00:00.000Z');
  assert.equal(parseSince('1d', NOW).toISOString(), '2026-11-02T12:00:00.000Z');
  assert.equal(parseSince('1w', NOW).toISOString(), '2026-10-27T12:00:00.000Z');
  assert.equal(parseSince(' 2H ', NOW).toISOString(), '2026-11-03T10:00:00.000Z');
});

test('--since as an ISO date or time', () => {
  assert.equal(parseSince('2026-11-03T08:00:00Z', NOW).toISOString(), '2026-11-03T08:00:00.000Z');
  assert.ok(parseSince('2026-11-03', NOW) instanceof Date);
});

test('--since refuses anything else', () => {
  for (const value of ['yesterday', '2h ago', '-1h', '2026-13-45', '12', '']) {
    assert.equal(parseSince(value, NOW), undefined, value);
  }
});

test('times ago', () => {
  assert.equal(formatAgo('2026-11-03T11:59:30Z', NOW), 'just now');
  assert.equal(formatAgo('2026-11-03T11:55:00Z', NOW), '5 min ago');
  assert.equal(formatAgo('2026-11-03T09:00:00Z', NOW), '3 h ago');
  assert.equal(formatAgo('2026-10-30T12:00:00Z', NOW), '4 days ago');
  assert.equal(formatAgo(null, NOW), 'never');
});

test('local times', () => {
  assert.match(formatLocal('2026-11-03T08:05:00Z'), /^2026-11-0[23] \d{2}:05$/);
  assert.equal(formatLocal(null), '-');
  assert.equal(formatLocal('not a date'), 'not a date');
});

test('seconds for --timeout and --interval', () => {
  assert.equal(parseSeconds('60'), 60);
  assert.equal(parseSeconds('5s'), 5);
  assert.equal(parseSeconds('1.5'), 1.5);
  for (const value of ['0', '-1', 'abc', '', undefined]) assert.equal(parseSeconds(value), undefined, String(value));
});
