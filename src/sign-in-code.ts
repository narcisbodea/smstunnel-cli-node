/**
 * Does a text for POST /sms/send-2fa carry a sign-in code? The same rule as SMSTunnel's own check
 * (utils/sign-in-code.util.ts on the server), so the CLI can say it before sending:
 * - 4 to 10 digits standing on their own: "123456", "Code:1234", "G-123456", "12-345678";
 * - or two groups of 3 digits joined by one dash: "123-456".
 * Not codes: words, letters mixed with digits ("A1B2C3"), 11 digits or more, digits right after a
 * "+" (a phone number), and digits joined to others by ".", ",", ":" or "/" (prices, times, dates).
 */
const SIGN_IN_CODE_PATTERNS: RegExp[] = [
  /(?<![\w+]|\d[.,:/])\d{4,10}(?!\w|[.,:/]\d)/,
  /(?<![\w+-]|\d[.,:/])\d{3}-\d{3}(?!\w|-\d|[.,:/]\d)/,
];

export function containsSignInCode(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return SIGN_IN_CODE_PATTERNS.some((pattern) => pattern.test(message));
}
