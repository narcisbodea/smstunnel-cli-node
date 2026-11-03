import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { smsParts, characterCount } = require('../../dist/sms-parts.js');

test('empty text has no parts', () => {
  assert.deepEqual(smsParts(''), { encoding: 'GSM-7', characters: 0, parts: 0 });
});

test('GSM-7: 160 in one part, then 153 per part', () => {
  assert.equal(smsParts('Hello').parts, 1);
  assert.equal(smsParts('a'.repeat(160)).parts, 1);
  assert.equal(smsParts('a'.repeat(161)).parts, 2);
  assert.equal(smsParts('a'.repeat(306)).parts, 2);
  assert.equal(smsParts('a'.repeat(307)).parts, 3);
  assert.equal(smsParts('Your order #1042 is ready: 12.50 EUR @ Main St.').encoding, 'GSM-7');
});

test('GSM-7 extension characters count twice', () => {
  assert.equal(smsParts('€'.repeat(80)).parts, 1);
  assert.equal(smsParts('€'.repeat(81)).parts, 2);
  assert.equal(smsParts('{}[]~^|\\').encoding, 'GSM-7');
});

test('Romanian diacritics and emoji switch to UCS-2: 70, then 67 per part', () => {
  assert.equal(smsParts('Mulțumim, ș și ț').encoding, 'UCS-2');
  assert.equal(smsParts('ș'.repeat(70)).parts, 1);
  assert.equal(smsParts('ș'.repeat(71)).parts, 2);
  assert.equal(smsParts('ș'.repeat(134)).parts, 2);
  assert.equal(smsParts('ș'.repeat(135)).parts, 3);
  const emoji = smsParts('😀');
  assert.equal(emoji.encoding, 'UCS-2');
  assert.equal(emoji.characters, 1);
});

test('characters are counted the way SMSTunnel counts them (an emoji is one)', () => {
  assert.equal(characterCount('abc'), 3);
  assert.equal(characterCount('😀😀'), 2);
  assert.equal(characterCount('ăîâșț'), 5);
});
