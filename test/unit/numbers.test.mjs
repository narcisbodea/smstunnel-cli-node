import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkRecipient, checkCountryCode, ONE_NUMBER_PER_TEXT } = require('../../dist/numbers.js');

test('numbers SMSTunnel takes', () => {
  for (const value of ['+40712345678', '0712 345 678', '(0721) 123-456', '0040712345678', '+1 415.555.0123', ' +40712345678 ']) {
    const checked = checkRecipient(value);
    assert.equal(checked.ok, true, value);
    assert.equal(checked.value, value.trim());
  }
});

test('one number per text: lists are refused', () => {
  for (const value of [
    '+40712345678,+40722333444',
    '0712345678; 0722333444',
    '+40712345678 +40722333444',
    '0712345678|0722333444',
    '0712345678 & 0722333444',
    '0712345678\n0722333444',
  ]) {
    const checked = checkRecipient(value);
    assert.equal(checked.ok, false, value);
    assert.equal(checked.message, ONE_NUMBER_PER_TEXT, value);
  }
});

test('two numbers run together are refused as more than one number', () => {
  for (const value of ['0712345678 0722333444', '0712345678/0722333444', '0712345678 or 0722333444']) {
    const checked = checkRecipient(value);
    assert.equal(checked.ok, false, value);
    assert.match(checked.message, /more than one number\. One number per text\./, value);
  }
});

test('words and malformed numbers are refused with a reason', () => {
  assert.match(checkRecipient('0721-CALL-ME').message, /not a phone number/);
  assert.match(checkRecipient('12345').message, /7 to 25 characters/);
  assert.match(checkRecipient('0721+123456').message, /\+ only at the start/);
  assert.match(checkRecipient('').message, /Give the number/);
  assert.match(checkRecipient(undefined).message, /Give the number/);
  assert.match(checkRecipient('0151/2345678').message, /7 to 25 characters/);
});

test('country calling codes', () => {
  for (const value of ['+40', '40', '0040', '1', '+1', '+353', ' +44 ']) {
    assert.equal(checkCountryCode(value).ok, true, value);
  }
  for (const value of ['RO', 'DE', '+40a', '0', '+', '+12345', '', undefined]) {
    const checked = checkCountryCode(value);
    assert.equal(checked.ok, false, String(value));
    assert.match(checked.message, /country calling code/);
  }
});
