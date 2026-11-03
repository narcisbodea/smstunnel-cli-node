// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../package.json') as { version: string };

export const VERSION: string = pkg.version;
export const DEFAULT_API_BASE = 'https://smstunnel.io/api/v1';
export const DASHBOARD_URL = 'https://dashboard.smstunnel.io';
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=io.smstunnel.app';
export const PRIVACY_URL = 'https://smstunnel.io/privacy/';

/** Longest text POST /sms/send takes, in characters. */
export const MAX_TEXT_LENGTH = 1600;
/** Longest sign-in code text POST /sms/send-2fa takes, in characters. */
export const MAX_CODE_TEXT_LENGTH = 320;

/** How the process ends. Documented in README.md ("Exit codes"). */
export const EXIT = {
  OK: 0,
  UNEXPECTED: 1,
  USAGE: 2,
  AUTH: 3,
  FORBIDDEN: 4,
  NOT_FOUND: 5,
  RATE_LIMITED: 6,
  UNAVAILABLE: 7,
  TEXT_FAILED: 8,
  STILL_WAITING: 9,
  INTERRUPTED: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
