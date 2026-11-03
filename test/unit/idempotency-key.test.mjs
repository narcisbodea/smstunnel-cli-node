import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkIdempotencyKey, MAX_IDEMPOTENCY_KEY_LENGTH } = require('../../dist/idempotency-key.js');

test('keys SMSTunnel takes: 1 to 255 printable ASCII characters, trimmed', () => {
  for (const value of ['a', 'order-1042-ready', 'b7d1c0e2-8f7a-4c47-9a39-3f5f2c3d9e10', 'with spaces inside', '"quoted"', 'x'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH)]) {
    assert.deepEqual(checkIdempotencyKey(value), { ok: true, value }, value);
  }
  assert.deepEqual(checkIdempotencyKey('  padded  '), { ok: true, value: 'padded' });
  assert.equal(MAX_IDEMPOTENCY_KEY_LENGTH, 255);
});

test('keys SMSTunnel refuses are refused before any call', () => {
  for (const value of ['', '   ', undefined, 'x'.repeat(256), 'commande-é', 'tab\there', 'emoji-😀', 'line\nbreak']) {
    const checked = checkIdempotencyKey(value);
    assert.equal(checked.ok, false, JSON.stringify(value));
    assert.match(checked.message, /^--idempotency-key takes 1 to 255 printable ASCII characters/);
  }
});
