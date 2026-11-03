/** The check SMSTunnel itself applies to `to` (SendSmsDto): 7 to 25 digits, spaces, dots, dashes, brackets or +. */
const SERVER_NUMBER_PATTERN = /^[\d\s.\-()+]{7,25}$/;

/** A number written with + or 00 has at most 15 digits (E.164), plus the 00. More means two numbers. */
const MAX_DIGITS = 17;
const MIN_DIGITS = 6;

export type Checked = { ok: true; value: string } | { ok: false; message: string };

export const ONE_NUMBER_PER_TEXT = 'One number per text.';

/**
 * One recipient, written the way SMSTunnel takes it. SMSTunnel completes a number without + or 00
 * with the country code (--country, then the one saved for your phone, then +40).
 * Lists ("a,b", "a;b", two numbers in one argument) are refused: one number per text.
 */
export function checkRecipient(input: string | undefined): Checked {
  const value = (input ?? '').trim();
  if (value === '') {
    return { ok: false, message: 'Give the number to text, like +40712345678.' };
  }
  if (/[,;|&\n\r\t]/.test(value)) {
    return { ok: false, message: ONE_NUMBER_PER_TEXT };
  }
  const plusSigns = (value.match(/\+/g) ?? []).length;
  if (plusSigns > 1) {
    return { ok: false, message: ONE_NUMBER_PER_TEXT };
  }
  if (plusSigns === 1 && !value.startsWith('+')) {
    return { ok: false, message: 'Put the + only at the start of the number, like +40712345678.' };
  }
  const digits = value.replace(/\D/g, '').length;
  if (digits > MAX_DIGITS) {
    return { ok: false, message: `That looks like more than one number. ${ONE_NUMBER_PER_TEXT}` };
  }
  if (/[a-z]/i.test(value)) {
    return {
      ok: false,
      message: `"${value}" is not a phone number: write it with digits, like +40712345678.`,
    };
  }
  if (!SERVER_NUMBER_PATTERN.test(value) || digits < MIN_DIGITS) {
    return {
      ok: false,
      message:
        'Write the number with 7 to 25 characters: digits, spaces, dots, dashes, brackets and a leading +, like +40712345678.',
    };
  }
  return { ok: true, value };
}

/**
 * --country: the calling code SMSTunnel adds to a number written without + or 00.
 * "+49", "49" and "0049" all work; letters such as "DE" are not codes.
 */
export function checkCountryCode(input: string | undefined): Checked {
  const value = (input ?? '').replace(/\s+/g, '');
  if (/^(\+|00)?[1-9]\d{0,3}$/.test(value)) {
    return { ok: true, value };
  }
  return {
    ok: false,
    message: 'Give the country calling code in digits, like --country +40 or --country 44 (not letters such as RO).',
  };
}
