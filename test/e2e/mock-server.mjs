// A stand-in for the SMSTunnel REST API (https://smstunnel.io/api/v1) for the CLI's end-to-end tests.
// Same routes, bodies and errors as the real API (see the API reference), plus a few numbers that
// trigger each refusal. It runs inside the test process; the CLI talks to it as a child process.
import http from 'node:http';

export const KEYS = {
  full: `sk_live_${'a'.repeat(32)}`,
  sendOnly: `sk_live_${'b'.repeat(32)}`,
  refused: `sk_live_${'c'.repeat(32)}`,
};

export const PHONES = [
  { id: 'a1a1a1a1a1a1a1a1a1a1a1a1', name: 'Desk phone', isOnline: true },
  { id: 'b2b2b2b2b2b2b2b2b2b2b2b2', name: 'Spare phone', isOnline: false },
  { id: 'c3c3c3c3c3c3c3c3c3c3c3c3', name: 'Twin', isOnline: true },
  { id: 'd4d4d4d4d4d4d4d4d4d4d4d4', name: 'Twin', isOnline: false },
];

/** Numbers that make the mock refuse the way SMSTunnel does. */
export const SPECIAL = {
  rateLimited: '+15550000429', // 429 with Retry-After: 7
  allowanceUsed: '+15550000430', // 429 without Retry-After (daily allowance)
  planRefused: '+15550000403', // 403 without a code
  serverProblem: '+15550000500', // 500
  validation: '+15550000400', // 400 with a list of messages
  connectionDrops: '+15550000999', // the connection closes after the request was read
};

/** Idempotency-Key values that make the mock answer the way SMSTunnel does. */
export const IDEMPOTENCY = {
  inProgress: 'still-in-progress', // 409 IDEMPOTENCY_KEY_IN_PROGRESS with Retry-After: 1
};

const SEND_FIELDS = new Set(['to', 'message', 'deviceId', 'defaultCountryCode']);
const SIGN_IN_CODE = [/(?<![\w+]|\d[.,:/])\d{4,10}(?!\w|[.,:/]\d)/, /(?<![\w+-]|\d[.,:/])\d{3}-\d{3}(?!\w|-\d|[.,:/]\d)/];

export async function startMockServer() {
  const state = {
    requests: [],
    messages: new Map(),
    received: [
      {
        id: 'e5e5e5e5e5e5e5e5e5e5e5e5',
        sender: '+40711111111',
        message: 'Earlier reply',
        isEncrypted: false,
        receivedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
        deviceId: PHONES[0].id,
        deviceName: 'Desk phone',
      },
      {
        id: 'f6f6f6f6f6f6f6f6f6f6f6f6',
        sender: '+40722222222',
        message: 'See you\nat 10',
        isEncrypted: false,
        receivedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        deviceId: PHONES[0].id,
        deviceName: 'Desk phone',
      },
    ],
    counter: 0,
    idempotency: new Map(),
    replays: 0,
  };

  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  };
  const nextId = () => (state.counter += 1).toString(16).padStart(24, '0');

  /** What SMSTunnel answers to a send: { status, body, headers }, or { drop: true } to break the connection. */
  const sendAnswer = (path, body) => {
    const answer = (status, b, headers = {}) => ({ status, body: b, headers });
    const extra = Object.keys(body ?? {}).filter((name) => !SEND_FIELDS.has(name));
    if (extra.length > 0) {
      return answer(400, { statusCode: 400, message: extra.map((name) => `property ${name} should not exist`), error: 'Bad Request' });
    }
    const { to, message, deviceId } = body ?? {};
    if (typeof to !== 'string' || typeof message !== 'string') {
      return answer(400, { statusCode: 400, message: ['to must be a string', 'message must be a string'], error: 'Bad Request' });
    }
    switch (to) {
      case SPECIAL.rateLimited:
        return answer(429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, { 'Retry-After': '7' });
      case SPECIAL.allowanceUsed:
        return answer(429, { statusCode: 429, message: "You've sent today's 25 texts on the Free plan. More go out tomorrow." });
      case SPECIAL.planRefused:
        return answer(403, { statusCode: 403, message: 'Maximum privacy needs the Professional or Enterprise plan', error: 'Forbidden' });
      case SPECIAL.serverProblem:
        return answer(500, { statusCode: 500, message: 'Internal server error' });
      case SPECIAL.validation:
        return answer(400, { statusCode: 400, message: ['Phone number must contain 7-25 characters', 'second problem'], error: 'Bad Request' });
      case SPECIAL.connectionDrops:
        return { drop: true };
      default:
        break;
    }
    if (path === '/sms/send-2fa' && !SIGN_IN_CODE.some((pattern) => pattern.test(message))) {
      return answer(400, { statusCode: 400, message: 'Invalid 2FA message: No valid verification code found', error: 'Bad Request' });
    }
    let phone = PHONES[0];
    if (deviceId !== undefined) {
      phone = PHONES.find((candidate) => candidate.id === deviceId);
      if (!phone) return answer(404, { statusCode: 404, message: 'Device not found', error: 'Not Found' });
    }
    const queued = !phone.isOnline;
    const messageId = nextId();
    state.messages.set(messageId, { to, message, deviceId: phone.id, queued, polls: 0, kind: path === '/sms/send-2fa' ? 'code' : 'text' });
    return answer(200, {
      success: true,
      messageId,
      ...(queued ? { queued: true } : {}),
      data: { messageId, branded: message.includes('BRANDED'), ...(queued ? { queued: true } : {}), remaining: { clean: 9, total: 'unlimited' } },
    });
  };

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://mock');
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = undefined;
    }
    const key = req.headers['x-api-key'];
    state.requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), url: req.url, headers: req.headers, body });

    // Bases that are not the SMSTunnel API, for --api-base mistakes.
    if (url.pathname.startsWith('/redirect-base/')) {
      res.writeHead(302, { Location: 'https://example.com/' });
      return res.end();
    }
    if (url.pathname.startsWith('/html-base/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>Some site</title>');
    }

    const path = url.pathname.replace(/^\/api\/v1/, '');
    if (!key) return json(res, 401, { statusCode: 401, message: 'API key is required.', error: 'Unauthorized' });
    if (key !== KEYS.full && key !== KEYS.sendOnly) {
      return json(res, 401, { statusCode: 401, message: 'Invalid or expired API key', error: 'Unauthorized' });
    }

    if (req.method === 'GET' && path === '/devices') {
      const devices = PHONES.map((phone) => ({ ...phone, lastSeenAt: new Date(Date.now() - (phone.isOnline ? 30_000 : 2 * 86_400_000)).toISOString() }));
      return json(res, 200, { success: true, data: { devices, online: devices.filter((d) => d.isOnline).length, total: devices.length } });
    }

    if (req.method === 'POST' && path === '/sms/send-bulk') {
      return json(res, 500, { statusCode: 500, message: 'The CLI must never call send-bulk' });
    }

    if (req.method === 'POST' && (path === '/sms/send' || path === '/sms/send-2fa')) {
      // Idempotency-Key, as public-api/idempotency does it: the same key and request within 24 h get
      // the first answer back (Idempotent-Replayed: true); a different request with the key gets 422;
      // 2xx and 5xx answers are kept, a 4xx frees the key.
      const rawKey = req.headers['idempotency-key'];
      const idemKey = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (idemKey !== '') {
        if (idemKey.length > 255 || !/^[\x20-\x7E]+$/.test(idemKey)) {
          return json(res, 400, { statusCode: 400, error: 'Bad Request', code: 'IDEMPOTENCY_KEY_INVALID', message: 'Idempotency-Key must be 1 to 255 printable ASCII characters (a UUID is a good choice).' });
        }
        if (idemKey === IDEMPOTENCY.inProgress) {
          return json(res, 409, { statusCode: 409, error: 'Conflict', code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message: 'A request with this Idempotency-Key is still being processed. Retry in a moment to get its result.' }, { 'Retry-After': '1' });
        }
        const scope = key + '\n' + idemKey;
        const fingerprint = path + '\n' + JSON.stringify(body ?? {});
        const stored = state.idempotency.get(scope);
        if (stored && stored.fingerprint !== fingerprint) {
          return json(res, 422, { statusCode: 422, error: 'Unprocessable Entity', code: 'IDEMPOTENCY_KEY_REUSED', message: 'This Idempotency-Key was already used in the last 24 hours for a different request (another endpoint, recipient, text, phone or country code). Use a new key for a new text.' });
        }
        if (stored) {
          state.replays += 1;
          return json(res, stored.status, stored.body, { 'Idempotent-Replayed': 'true' });
        }
        const answer = sendAnswer(path, body);
        if (answer.drop) {
          state.idempotency.set(scope, { fingerprint, status: 500, body: { statusCode: 500, message: 'Internal server error' } });
          req.socket.destroy();
          return undefined;
        }
        if (answer.status < 300 || answer.status >= 500) state.idempotency.set(scope, { fingerprint, status: answer.status, body: answer.body });
        return json(res, answer.status, answer.body, answer.headers);
      }
      const answer = sendAnswer(path, body);
      if (answer.drop) {
        req.socket.destroy();
        return undefined;
      }
      return json(res, answer.status, answer.body, answer.headers);
    }

    const status = /^\/sms\/status\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && status) {
      const record = state.messages.get(status[1]);
      if (!record) return json(res, 404, { statusCode: 404, message: 'Message not found', error: 'Not Found' });
      record.polls += 1;
      if (record.message.includes('STATUS403')) {
        return json(res, 403, { statusCode: 403, error: 'Forbidden', code: 'PERMISSION_REQUIRED', permission: 'sms:read', message: "This API key lacks the 'sms:read' permission" });
      }
      if (record.message.includes('STATUS429ONCE') && record.polls === 1) {
        return json(res, 429, { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, { 'Retry-After': '1' });
      }
      const base = { id: status[1], phoneNumber: record.to, sentAt: null, deliveredAt: null, errorMessage: null };
      let data;
      if (record.queued || record.polls < 2) {
        data = { ...base, status: 'pending', deliveryStatus: 'pending' };
      } else if (record.message.includes('FAILME')) {
        data = { ...base, status: 'failed', deliveryStatus: 'failed', errorMessage: 'Generic failure (the SIM refused it)' };
      } else if (record.message.includes('UNCONFIRMED')) {
        data = {
          ...base,
          status: 'failed',
          unconfirmed: true,
          deliveryStatus: 'unconfirmed',
          errorMessage: 'Not confirmed by the phone - the SMS may have been sent; it is not resent automatically',
        };
      } else {
        data = { ...base, status: 'sent', deliveryStatus: 'sent', sentAt: new Date().toISOString() };
      }
      return json(res, 200, { success: true, data });
    }

    if (req.method === 'GET' && path === '/sms/received') {
      if (key === KEYS.sendOnly) {
        return json(res, 403, {
          statusCode: 403,
          error: 'Forbidden',
          code: 'PERMISSION_REQUIRED',
          permission: 'sms:inbox',
          message: "This API key may not read received texts. Allow it in the dashboard (API Keys → 'Allow reading received messages') or create a key with that permission.",
        });
      }
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 100);
      const since = url.searchParams.get('since');
      const from = url.searchParams.get('phone');
      const deviceId = url.searchParams.get('deviceId');
      let rows = [...state.received];
      if (since) rows = rows.filter((row) => new Date(row.receivedAt) >= new Date(since));
      if (from) rows = rows.filter((row) => row.sender.replace(/\D/g, '').includes(from.replace(/\D/g, '')));
      if (deviceId) rows = rows.filter((row) => row.deviceId === deviceId);
      rows.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
      const page = rows.slice(0, limit);
      return json(res, 200, { success: true, data: { messages: page, total: rows.length, page: 1, limit, hasMore: rows.length > limit } });
    }

    if (req.method === 'GET' && path === '/account/usage') {
      return json(res, 200, {
        success: true,
        data: {
          plan: 'free',
          accountType: 'standard',
          usage: { smsClean: 3, smsBranded: 0, twoFaClean: 1, smsCleanMonth: 40 },
          limits: { smsClean: 25, twoFaClean: 20, smsCleanPerMonth: 500, smsBrandedPerDay: 25 },
          remaining: { smsClean: 22, twoFaClean: 19, smsCleanMonth: 460, smsBranded: 25 },
        },
      });
    }

    return json(res, 404, { statusCode: 404, message: `Cannot ${req.method} ${url.pathname}`, error: 'Not Found' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    apiBase: `http://127.0.0.1:${port}/api/v1`,
    state,
    addReceived(text) {
      const row = { isEncrypted: false, deviceId: PHONES[0].id, deviceName: 'Desk phone', receivedAt: new Date().toISOString(), ...text };
      state.received.push(row);
      return row;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
