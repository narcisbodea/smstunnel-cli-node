import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ApiError, parseRetryAfter, errorMessageFrom } = require('../../dist/api.js');
const { describeApiError } = require('../../dist/errors.js');

const BASE = 'https://smstunnel.io/api/v1';
const httpError = (status, extra = {}) => new ApiError({ kind: 'http', status, message: extra.message ?? `HTTP ${status}`, mayHaveArrived: true, ...extra });
const describe = (error, operation = 'phones', keySource = 'stored') => describeApiError(error, { operation, keySource, apiBase: BASE });

test('network error before the request left: could not reach, exit 7', () => {
  const error = new ApiError({ kind: 'network', message: 'connect ECONNREFUSED', networkCode: 'ECONNREFUSED', mayHaveArrived: false });
  for (const operation of ['phones', 'send']) {
    const result = describe(error, operation);
    assert.equal(result.exitCode, 7);
    assert.match(result.message, /Could not reach SMSTunnel at smstunnel\.io \(ECONNREFUSED\)/);
  }
});

test('a send whose connection broke after it left may have gone out: never resend blindly', () => {
  const error = new ApiError({ kind: 'network', message: 'socket hang up', networkCode: 'ECONNRESET', mayHaveArrived: true });
  const result = describe(error, 'send');
  assert.equal(result.exitCode, 7);
  assert.match(result.message, /may have gone out/);
  assert.match(result.message, /before you send it again/);
  const timeout = describe(new ApiError({ kind: 'timeout', message: 'No answer', networkCode: 'ETIMEDOUT', mayHaveArrived: true }), 'code');
  assert.match(timeout.message, /may have gone out/);
  // The same break on a read is just "could not reach".
  assert.match(describe(error, 'status').message, /Could not reach/);
});

test('400: SMSTunnel refused the input, exit 2', () => {
  const result = describe(httpError(400, { message: 'Phone number must contain 7-25 characters; message should not be empty' }), 'send');
  assert.equal(result.exitCode, 2);
  assert.equal(result.message, 'SMSTunnel refused the request: Phone number must contain 7-25 characters; message should not be empty');
});

test('401: the key was refused, exit 3, and says where the key came from', () => {
  const stored = describe(httpError(401, { message: 'Invalid or expired API key' }), 'phones', 'stored');
  assert.equal(stored.exitCode, 3);
  assert.match(stored.message, /refused the API key \(the saved key\)/);
  assert.match(stored.message, /Apps → Add an app/);
  assert.match(stored.message, /smstunnel login" again/);
  const env = describe(httpError(401), 'send', 'env');
  assert.match(env.message, /SMSTUNNEL_API_KEY/);
  const typed = describe(httpError(401), 'login', 'typed');
  assert.doesNotMatch(typed.message, /login" again/);
});

test('403 PERMISSION_REQUIRED names the permission, exit 4', () => {
  const inbox = describe(httpError(403, { code: 'PERMISSION_REQUIRED', permission: 'sms:inbox' }), 'received');
  assert.equal(inbox.exitCode, 4);
  assert.match(inbox.message, /may not read received texts/);
  assert.match(inbox.message, /allow reading received messages/);
  assert.match(inbox.message, /Sync received texts/);
  assert.match(describe(httpError(403, { code: 'PERMISSION_REQUIRED', permission: 'sms:send' }), 'send').message, /may not send texts/);
  assert.match(describe(httpError(403, { code: 'PERMISSION_REQUIRED', permission: 'sms:read' }), 'status').message, /sms:read/);
  assert.match(describe(httpError(403, { code: 'PERMISSION_REQUIRED', permission: 'x:y' }), 'status').message, /"x:y"/);
});

test('403 without a code: the plan, with the server message, exit 4', () => {
  const result = describe(httpError(403, { message: 'Maximum privacy needs the Professional or Enterprise plan' }), 'send');
  assert.equal(result.exitCode, 4);
  assert.equal(result.message, 'SMSTunnel refused this: Maximum privacy needs the Professional or Enterprise plan');
});

test('404, exit 5', () => {
  assert.equal(describe(httpError(404, { message: 'Message not found' }), 'status').message, 'No text with that id for this key.');
  const phone = describe(httpError(404, { message: 'Device not found' }), 'send');
  assert.equal(phone.exitCode, 5);
  assert.match(phone.message, /Device not found\. List your phones/);
  assert.equal(describe(httpError(404, { message: 'Cannot GET /x' }), 'usage').exitCode, 5);
});

test('429 with Retry-After: too many requests, wait N seconds, exit 6', () => {
  const send = describe(httpError(429, { message: 'ThrottlerException: Too Many Requests', retryAfter: 42 }), 'send');
  assert.equal(send.exitCode, 6);
  assert.equal(send.message, 'Too many texts in a minute: SMSTunnel takes up to 30 send requests a minute. Try again in 42 seconds.');
  assert.equal(send.details.retryAfter, 42);
  assert.equal(describe(httpError(429, { retryAfter: 1 }), 'phones').message, 'Too many requests in a minute. Try again in 1 second.');
});

test('429 without Retry-After: the allowance, in the server words, exit 6', () => {
  const said = "You've sent today's 25 texts on the Free plan.";
  const result = describe(httpError(429, { message: said }), 'send');
  assert.equal(result.exitCode, 6);
  assert.equal(result.message, said);
  assert.match(describe(httpError(429), 'send').message, /allowance for today is used up/);
});

test('5xx: SMSTunnel had a problem, exit 7; a send may or may not have been taken', () => {
  const read = describe(httpError(503), 'usage');
  assert.equal(read.exitCode, 7);
  assert.match(read.message, /HTTP 503\)\. Try again/);
  assert.match(describe(httpError(500), 'send').message, /may or may not have been taken/);
});

test('redirects and answers that are not the API: exit 7', () => {
  assert.equal(describe(new ApiError({ kind: 'redirect', status: 302, message: 'x', mayHaveArrived: true })).exitCode, 7);
  const html = describe(new ApiError({ kind: 'invalid-response', status: 200, message: 'not JSON', mayHaveArrived: true }));
  assert.equal(html.exitCode, 7);
  assert.match(html.message, /--api-base/);
});

test('any other refusal: exit 1', () => {
  assert.equal(describe(httpError(409, { message: 'Conflict' })).exitCode, 1);
});

test('Retry-After as seconds or as a date', () => {
  assert.equal(parseRetryAfter('7'), 7);
  assert.equal(parseRetryAfter(['12']), 12);
  assert.equal(parseRetryAfter(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000), 30);
  assert.equal(parseRetryAfter(undefined), undefined);
  assert.equal(parseRetryAfter('soon'), undefined);
});

test('error bodies: a list is joined, else message, error or short plain text', () => {
  assert.equal(errorMessageFrom({ message: ['a', 'b'] }, '', 400), 'a; b');
  assert.equal(errorMessageFrom({ message: 'Invalid phone number' }, '', 400), 'Invalid phone number');
  assert.equal(errorMessageFrom({ error: 'Bad Request' }, '', 400), 'Bad Request');
  assert.equal(errorMessageFrom(undefined, 'Service Unavailable', 503), 'Service Unavailable');
  assert.equal(errorMessageFrom(undefined, '<html>…</html>', 502), 'HTTP 502');
});
