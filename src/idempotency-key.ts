/**
 * --idempotency-key: sent as the Idempotency-Key header of POST /sms/send and /sms/send-2fa. A second
 * request with the same key within 24 hours gets the first answer back instead of a second text
 * (the server's public-api/idempotency). Same rule as the server: 1 to 255 printable ASCII characters.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export type CheckedKey = { ok: true; value: string } | { ok: false; message: string };

export function checkIdempotencyKey(input: string | undefined): CheckedKey {
  const value = (input ?? '').trim();
  if (value !== '' && value.length <= MAX_IDEMPOTENCY_KEY_LENGTH && /^[\x20-\x7e]+$/.test(value)) {
    return { ok: true, value };
  }
  return {
    ok: false,
    message:
      '--idempotency-key takes 1 to 255 printable ASCII characters (letters, digits and signs such as - _ . :), like --idempotency-key order-1042-ready. A UUID is a good choice.',
  };
}
