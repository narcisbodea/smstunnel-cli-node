import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseArgs } = require('../../dist/args.js');

const SPECS = [
  { name: 'json', type: 'boolean' },
  { name: 'api-base', type: 'string' },
  { name: 'help', type: 'boolean', short: 'h' },
  { name: 'version', type: 'boolean', short: 'v' },
  { name: 'phone', type: 'string' },
  { name: 'wait', type: 'boolean' },
];

test('command, positionals and options in any order', () => {
  const parsed = parseArgs(['send', '--wait', '+40712345678', 'Hello', 'there', '--phone', 'Store phone'], SPECS);
  assert.deepEqual(parsed.positionals, ['send', '+40712345678', 'Hello', 'there']);
  assert.deepEqual(parsed.options, { wait: true, phone: 'Store phone' });
});

test('--name=value and --name value', () => {
  assert.equal(parseArgs(['--api-base=http://localhost:3101'], SPECS).options['api-base'], 'http://localhost:3101');
  assert.equal(parseArgs(['--api-base', 'http://localhost:3101'], SPECS).options['api-base'], 'http://localhost:3101');
});

test('everything after -- is a positional', () => {
  const parsed = parseArgs(['send', '+40712345678', '--', '--wait', 'is', 'part', 'of', 'the', 'text'], SPECS);
  assert.deepEqual(parsed.positionals, ['send', '+40712345678', '--wait', 'is', 'part', 'of', 'the', 'text']);
  assert.deepEqual(parsed.options, {});
});

test('a word starting with a single dash stays in the text', () => {
  const parsed = parseArgs(['send', '+40712345678', '-20%', 'today', '-', 'only'], SPECS);
  assert.deepEqual(parsed.positionals, ['send', '+40712345678', '-20%', 'today', '-', 'only']);
});

test('short forms -h and -v', () => {
  assert.equal(parseArgs(['-h'], SPECS).options.help, true);
  assert.equal(parseArgs(['-v'], SPECS).options.version, true);
});

test('an unknown --option is refused with exit code 2', () => {
  assert.throws(() => parseArgs(['phones', '--loud'], SPECS), (error) => error.exitCode === 2 && /Unknown option --loud/.test(error.message));
});

test('a string option without a value is refused', () => {
  assert.throws(() => parseArgs(['send', '--phone'], SPECS), (error) => error.exitCode === 2 && /needs a value/.test(error.message));
  assert.throws(() => parseArgs(['send', '--phone', '--wait'], SPECS), (error) => error.exitCode === 2);
  assert.throws(() => parseArgs(['send', '--phone='], SPECS), (error) => error.exitCode === 2);
});

test('a boolean option given a value is refused', () => {
  assert.throws(() => parseArgs(['send', '--wait=yes'], SPECS), (error) => error.exitCode === 2 && /takes no value/.test(error.message));
});

test('the last value of a repeated option wins', () => {
  assert.equal(parseArgs(['--phone', 'a', '--phone', 'b'], SPECS).options.phone, 'b');
});
