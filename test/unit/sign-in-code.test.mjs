import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { containsSignInCode } = require('../../dist/sign-in-code.js');

// The examples of the API reference (Send a Sign-in Code → What counts as a code).
test('texts with a code', () => {
  for (const text of [
    '123456',
    'Code: 1234',
    'Code:1234',
    'G-123456',
    '12-345678',
    '123-456',
    'Your sign-in code is 482913. It expires in 5 minutes.',
    '123456 is your code',
    'Your login code is 12-345678.',
    '2026',
  ]) {
    assert.equal(containsSignInCode(text), true, text);
  }
});

test('texts without a code', () => {
  for (const text of [
    'hello there',
    'A1B2C3',
    'ORD12345 has shipped',
    '12345678901',
    'Call +40712345678',
    'Pi is 3.14159',
    'See you on 01/11/2026',
    'Meet at 10:30',
    '123',
    '',
  ]) {
    assert.equal(containsSignInCode(text), false, text);
  }
  assert.equal(containsSignInCode(undefined), false);
  assert.equal(containsSignInCode(123456), false);
});
