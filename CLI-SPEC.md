# smstunnel CLI: behaviour specification

This is the exact behaviour of the Node.js CLI `smstunnel` (npm package `smstunnel`, version 1.0.0, source in `src/`),
written so that a native port (Go, for winget, Scoop, apt, dnf, AUR and Homebrew) can be built and tested against it.
Every statement comes from the source and the tests in this repository. Strings in `code` or in blocks are exact,
including punctuation and the Unicode characters `→` (U+2192) and `…` (U+2026).

Markers:

- **[NODE]**: how the Node version does it. The port must give the same result for the user, not use the same mechanism.
- **[PORT]**: a decision the port has to make, with the option that stays compatible with the Node version.

Constants used below:

| Name | Value |
|---|---|
| `VERSION` | the package version, `1.0.0` |
| `DEFAULT_API_BASE` | `https://smstunnel.io/api/v1` |
| `DASHBOARD_URL` | `https://dashboard.smstunnel.io` |
| `PLAY_URL` | `https://play.google.com/store/apps/details?id=io.smstunnel.app` |
| `MAX_TEXT_LENGTH` | 1600 |
| `MAX_CODE_TEXT_LENGTH` | 320 |
| `MAX_IDEMPOTENCY_KEY_LENGTH` | 255 |

## 1. Output channels

- Results meant for people go to **stdout**, one line per `println`, each ending in `\n`.
- Notes, warnings, progress and the key prompt go to **stderr**.
- Errors go to **stderr**: the message plus `\n` (human), or one line of JSON plus `\n` (see 1.2).
- No colours, no terminal control sequences, no paging. Line endings are always `\n`, on every system.

### 1.1 JSON results

With the parsed option `--json`, a command's result is written to stdout as JSON **pretty-printed with 2-space
indentation** (JavaScript `JSON.stringify(value, null, 2)`) followed by `\n`. Exception: `received --watch --json`
writes one compact JSON object per line (`JSON.stringify(value)`). Object members keep the order given in this document.
Members whose value is `undefined` are left out; `null` is written as `null`.

### 1.2 Errors

Errors of the CLI (class `CliError`: a message, an exit code and details) are reported as:

- human: `<message>\n` on stderr;
- JSON: `{"error":{"message":<message>,"exitCode":<code>,...details}}\n` on stderr, compact (no spaces), where details are,
  in this order and only when set: `status` (HTTP status), `code` (SMSTunnel's error code), `permission`, `retryAfter`
  (seconds), `messageId`.

Any other error (a bug): human `Unexpected error: <stack trace or message>\n`; JSON
`{"error":{"message":<message>,"exitCode":1}}\n`; exit code 1.

**Which form**: errors use JSON when the literal argument `--json` appears **anywhere** in the arguments, even after
`--` (the check is `argv.includes('--json')`, made before parsing). Results use JSON only when the parsed option is set
(a `--json` after `--` is text, so the result is human but its errors would be JSON). `--json=x` is not `--json`.

With `--json`, these still go to stderr as plain text: the key prompt and the notes of `login` and `logout`, the
file-store warning of `login`, and the retry notes of `received --watch`. `send --wait` prints no progress notes with
`--json`.

## 2. Arguments

### 2.1 Parsing (`parseArgs`)

The parser walks the arguments once, left to right; options may come before or after the command and between words.

1. `--` ends the options: every later argument is a positional, as it is.
2. A token that starts with `--` and is longer than 2 characters is an option: the name is the text after `--` up to the
   first `=` (if any).
   - Unknown name: exit 2, `Unknown option --<name>. See "smstunnel --help".`
   - Boolean option given `=value`: exit 2, `--<name> takes no value.`
   - String option: the value is the text after `=`, else the next argument. When there is no next argument, or the next
     argument is itself an option (starts with `--` and is longer than 2): exit 2, `--<name> needs a value.` An empty
     value (`--phone=`) also gives `--<name> needs a value.` The next argument may start with a single `-`
     (`--country -1` takes `-1`).
   - A repeated option: the last value wins.
3. A token that is exactly `-` plus one ASCII letter and is a known short form is that option: `-h` = `--help`,
   `-v` = `--version`. (No string option has a short form.)
4. Anything else is a positional, including `-`, `-20%`, `-x` and words of the text. Note: `-v` and `-h` inside a text
   are taken as options (`smstunnel send +40712345678 -v` prints the version); quote the text or use `--`.

The parser knows every option of every command (one shared list), then each command checks which ones it accepts (2.3).

### 2.2 Options

| Option | Type | Short | Commands |
|---|---|---|---|
| `--json` | boolean | | all |
| `--api-base <url>` | string | | all |
| `--help` | boolean | `-h` | all |
| `--version` | boolean | `-v` | all |
| `--phone <id or name>` | string | | send, code, received |
| `--country <code>` | string | | send, code |
| `--wait` | boolean | | send, code |
| `--timeout <seconds>` | string | | send, code |
| `--idempotency-key <key>` | string | | send, code |
| `--since <when>` | string | | received |
| `--from <number>` | string | | received |
| `--limit <n>` | string | | received |
| `--watch` | boolean | | received |
| `--interval <seconds>` | string | | received |

### 2.3 Dispatch order (`main`)

The first positional is the command, the rest are its arguments.

1. Parse (2.1). A parse error ends here (exit 2).
2. `--version` (anywhere, with or without a command): print `VERSION\n` to stdout, exit 0.
3. Command `help`: print the help for the next positional (section 12: a command's help, or the main help when it is
   missing or unknown) to stdout, exit 0.
4. No command: print the main help to stdout; exit 0 when `--help` was given, else exit 2.
5. Unknown command: exit 2, `Unknown command "<command>". See "smstunnel --help".` (also with `--help`).
6. `--help`: print the command's help to stdout, exit 0 (before the option check, so `phones --wait --help` prints help).
7. An option the command doesn't take: exit 2,
   `--<name> is not an option of "smstunnel <command>". See "smstunnel <command> --help".` (first such option in parse
   order).
8. Work out the API address (3.1). An invalid address: exit 2.
9. Run the command.

Commands: `login`, `logout`, `phones`, `send`, `code`, `status`, `received`, `usage` (and `help`).

## 3. Configuration

### 3.1 API address

The first of these that is set: `--api-base`, then `SMSTUNNEL_API_BASE` (when not empty), then `apiBase` in
`config.json`, then `DEFAULT_API_BASE`. Each is normalised:

1. Trim it and parse it as a URL. Not a URL: exit 2, `"<input as given>" is not a URL. Use something like https://smstunnel.io/api/v1.`
2. The scheme must be `https`, or `http` with the host `localhost`, `127.0.0.1` or `[::1]`. Otherwise: exit 2,
   `The API address must start with https:// (http:// only for localhost).`
3. A user name or password in it: exit 2, `The API address may not contain a user name or password.`
4. A non-empty query or fragment (`?x=1`, `#top`): exit 2, `The API address may not contain "?" or "#".` A lone `?` or
   `#` is empty after URL parsing, so it is accepted and dropped.
5. Result: `<scheme>://<host[:port]><path>` with the trailing slashes of the path removed; an empty path becomes
   `/api/v1`. WHATWG URL rules apply: the host is lower-cased and a default port is dropped
   (`https://SMSTUNNEL.io:443/` → `https://smstunnel.io/api/v1`).

Examples: `https://smstunnel.io` → `https://smstunnel.io/api/v1`; `https://smstunnel.io/api/v1/` →
`https://smstunnel.io/api/v1`; `http://localhost:3121` → `http://localhost:3121/api/v1`; `http://127.0.0.1:3121/api/v1`
stays. Refused: `http://example.com/api/v1`, `ftp://smstunnel.io`, `https://user:pass@smstunnel.io`,
`https://smstunnel.io/api/v1?x=1`, `not a url`.

Request URLs are the address plus the path, such as `https://smstunnel.io/api/v1/devices`.

### 3.2 The API key

The first of these: `SMSTUNNEL_API_KEY` trimmed, when not empty (not checked against the key pattern); else the saved
key (section 4). No key: exit 3,

```
No API key yet. Run "smstunnel login" and paste a key from your dashboard (https://dashboard.smstunnel.io → Apps → Add an app), or set SMSTUNNEL_API_KEY.
```

`login` and `logout` never need a key to start.

### 3.3 Environment variables

| Variable | Effect |
|---|---|
| `SMSTUNNEL_API_KEY` | A key used instead of the saved one (trimmed; empty = not set). |
| `SMSTUNNEL_API_BASE` | The API address when `--api-base` is not given (empty = not set). |
| `SMSTUNNEL_KEY_STORE` | `auto` (default) or `file`, case-insensitive. `file`: `login` saves the key in `config.json` even when a system store exists. Any other value: exit 2, `SMSTUNNEL_KEY_STORE takes "auto" or "file".` (checked only when `login` saves). |
| `SMSTUNNEL_CONFIG_DIR` | The folder of `config.json` (used as given when not empty). |
| `SMSTUNNEL_KEYCHAIN_SERVICE` | The service / resource name in the system store, default `smstunnel`. Must match `^[A-Za-z0-9._-]{1,64}$`, else exit 2, `SMSTUNNEL_KEYCHAIN_SERVICE may only hold letters, digits, ".", "_" and "-".` (checked when a system store is used). |
| `SMSTUNNEL_POLL_INTERVAL_MS` | For tests: when it is a finite number ≥ 50, it replaces the polling pace of `--wait` (2000 ms) and `--watch` (`--interval` seconds). |
| `APPDATA`, `XDG_CONFIG_HOME`, `HOME`, `PATH`, `DBUS_SESSION_BUS_ADDRESS`, `SystemRoot` | Used as described in section 4. |

## 4. Where the key is saved

### 4.1 `config.json`

Folder: `SMSTUNNEL_CONFIG_DIR` when set; on Windows `%APPDATA%\smstunnel` (or `<home>\AppData\Roaming\smstunnel` when
`APPDATA` is not set); elsewhere, macOS included, `$XDG_CONFIG_HOME/smstunnel` or `~/.config/smstunnel`.
File: `<folder>/config.json`.

Content: a JSON object with only these members, in this order, each only when set, pretty-printed (2 spaces), ending
in `\n`:

```json
{
  "keyStore": "macos-keychain | windows-credential-manager | secret-service | file",
  "apiBase": "the normalised API address, only when it is not DEFAULT_API_BASE",
  "apiKey": "the key, only with keyStore \"file\""
}
```

Writing: create the folder (recursively) with mode 0700 and set 0700 on it (ignore a failure), write
`config.json.<pid>.tmp` with mode 0600, set 0600, rename it over `config.json`. Reading: a missing file is `{}`; a
file that can't be read: exit 1, `Could not read <path>: <reason>`; invalid JSON: exit 1,
`<path> is not valid JSON. Delete it and run "smstunnel login" again.`; JSON that is not an object is `{}`.

Loading the saved key: `keyStore` `file`, or no `keyStore` but an `apiKey`: that `apiKey` (none: no key). A system
`keyStore`: ask that store; when it has no entry: exit 3, `The saved key is missing from <store label>. Run "smstunnel login" again.`
Any other or missing `keyStore`: no key.

### 4.2 System stores

The store `login` tries, by system: macOS → Keychain; Windows → Credential Manager; Linux, FreeBSD, OpenBSD → Secret
Service; anything else → none (file). Account / user name: `api-key`. Service / resource: `SMSTUNNEL_KEYCHAIN_SERVICE`
or `smstunnel`. Label: `SMSTunnel API key`. Each tool call has a 20-second limit. The key is never passed in arguments.

| `keyStore` | Label (in messages) | Available when |
|---|---|---|
| `macos-keychain` | `your macOS Keychain` | `/usr/bin/security` exists |
| `windows-credential-manager` | `Windows Credential Manager` | `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe` exists (`SystemRoot`, else `SYSTEMROOT`, else `C:\Windows`) |
| `secret-service` | `your system keyring (Secret Service)` | `secret-tool` is an executable in `PATH` **and** `DBUS_SESSION_BUS_ADDRESS` is set |
| `file` | the path of `config.json` | always |

**macOS** [NODE: `/usr/bin/security`]:
- save: run `/usr/bin/security -i` and write to its stdin the line
  `add-generic-password -U -a "api-key" -s "<service>" -l "SMSTunnel API key" -w "<key>"` + `\n`;
- load: `/usr/bin/security find-generic-password -a api-key -s <service> -w`; exit 0 → stdout trimmed (empty = none);
- remove: `/usr/bin/security delete-generic-password -a api-key -s <service>`; removed when exit 0.

**Secret Service** [NODE: `secret-tool`]:
- save: `secret-tool store --label=SMSTunnel API key service <service> account api-key` (the label is one argument) with
  the key on stdin, no newline;
- load: `secret-tool lookup service <service> account api-key`; exit 0 → stdout trimmed;
- remove: `secret-tool clear service <service> account api-key`; removed when exit 0.

**Windows** [NODE: Windows PowerShell 5.1 with the WinRT `Windows.Security.Credentials.PasswordVault`, run as
`powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand <UTF-16LE base64 script>`, the key on stdin]. The
entry is a PasswordVault credential, resource `<service>`, user name `api-key`, password = the key; it shows in
Credential Manager under **Web Credentials**. Save removes every credential of that resource, then adds the new one;
load retrieves `(<service>, api-key)`; remove deletes every credential of the resource and counts as removed when at
least one was there.
**[PORT]**: to read keys saved by the Node version (and the reverse) under `keyStore: "windows-credential-manager"`, use
the same PasswordVault entry (WinRT `PasswordVault`, resource `smstunnel`, user `api-key`). If the port uses Credential
Manager generic credentials instead (`CredWriteW`), it must write another `keyStore` value so neither version misreads
the other's `config.json`.

After each save the CLI loads the key back; when the store refuses, or gives back something else, the save counts as
failed.

### 4.3 Saving at login (`saveKey`)

1. The key must match `^[A-Za-z0-9_.-]{8,256}$`, else exit 2,
   `That does not look like an SMSTunnel API key (they look like sk_live_…).` Nothing is written.
2. Pick the system store (4.2) unless `SMSTUNNEL_KEY_STORE=file`.
3. Store available: save there; then write `config.json` with `keyStore` = that store and `apiBase` (no `apiKey`, so a
   key left in the file by an earlier login goes away). Done.
4. Otherwise the key goes to the file, with the reason (used in the warning, 5.1):
   - the store failed: `<store label> did not take it (<error message, or "unknown error">)` (for Windows only the first
     line of PowerShell's stderr);
   - a store exists but is not available: `<store label> is not available here`;
   - `SMSTUNNEL_KEY_STORE=file`: `SMSTUNNEL_KEY_STORE=file`;
   - no store for this system: `no system keychain is known on this system`.
   If the previous `config.json` named a system store, its entry is removed (errors ignored). Then `config.json` gets
   `keyStore: "file"`, `apiBase`, `apiKey`.

## 5. Commands

Every command first works out the address (3.1). Commands that call SMSTunnel load the key (3.2) after their own
argument checks and before the first request.

### 5.1 `smstunnel login`

- Any argument: exit 2,
  ``Don't put the key on the command line: it would stay in your shell history. Run "smstunnel login" and paste it when asked, or pipe it in: echo "$KEY" | smstunnel login``
- `SMSTUNNEL_API_KEY` set: stderr `Note: SMSTUNNEL_API_KEY is set, so it keeps being used instead of the key you save now.`
- Address is not `DEFAULT_API_BASE`: stderr `Signing in at <address>`.
- Prompt on stderr: `Paste your SMSTunnel API key (https://dashboard.smstunnel.io → Apps → Add an app) and press Enter: `
  (ends with a space, no newline).
  - Terminal (stdin is a TTY that supports raw mode): raw mode; each typed character is echoed as `*` on stderr;
    Backspace (`\x7f` or `\b`) removes the last character and writes `\b \b`; Enter (`\r` or `\n`) or Ctrl+D (`\x04`) ends;
    Ctrl+C (`\x03`) ends with exit 130 and the message `Stopped.`; other control characters (below U+0020) are ignored;
    then `\n` on stderr; the value is trimmed.
  - Not a terminal: read stdin until the first line that is not blank (or to the end when there is no newline), take that
    line trimmed; then write `\n` on stderr.
- Empty: exit 2, `No key was given.`
- Not `^[A-Za-z0-9_.-]{8,256}$`: exit 2, `That does not look like an SMSTunnel API key (they look like sk_live_…).`
- Check: `GET /devices` with the key (errors per section 7, operation `login`, key source "typed"). A refused key is
  never saved.
- Save (4.3) with `apiBase` = the address when it is not the default.
- Human output, stdout:
  - `Signed in with <masked key>. The key is saved in <label>.`
  - no phones: `No phones are linked yet: install the SMSTunnel app on your Android phone and sign in (https://play.google.com/store/apps/details?id=io.smstunnel.app).`
  - else `Your phones: <name> (online|offline), <name> (online|offline)` (`, ` between them, server order).
- JSON output: `{"signedIn": true, "key": "<masked>", "keyStore": "<kind>", "savedIn": "<label>", "apiBase": "<address>", "phones": [<devices as the server sent them>]}`.
- When the key went to the file, in both modes, stderr:
  `Warning: <reason>, so the key is saved in a file that only your user account can read (<path>). Anyone who can sign in as you can read it; "smstunnel logout" removes it.`
- Exit 0.

Masked key: when it has 14 characters or fewer, its first 3 characters + `…`; else its first 10 + `…` + its last 4
(`sk_live_` followed by `0123456789abcdef` twice → `sk_live_01…cdef`, `sk_short` → `sk_…`). The full key is never printed.

### 5.2 `smstunnel logout`

- Any argument: exit 2, `"smstunnel logout" takes no arguments.`
- Remove (no network call): read `config.json`; if it names a system store, remove the entry there (its label is
  recorded when the store says it removed one; errors ignored); if `config.json` has an `apiKey`, record its path; delete
  `config.json` when it exists (also when it held only `apiBase`).
- Human: something removed → `Signed out: the key was removed from <label>[ and <label>]. The key itself keeps working until you deactivate or delete it in your dashboard (Apps).`;
  nothing → `There was no saved key on this computer.`
- JSON: `{"signedOut": true, "removedFrom": [<labels>]}`.
- `SMSTUNNEL_API_KEY` set: stderr `Note: SMSTUNNEL_API_KEY is still set in your environment; unset it too.` (both modes).
- Exit 0.

### 5.3 `smstunnel phones`

- Any argument: exit 2, `"smstunnel phones" takes no arguments.`
- `GET /devices`. `data` missing → `{"devices": [], "online": 0, "total": 0}`.
- JSON: `data` as the server sent it: `{"devices": [{"id", "name", "isOnline", "lastSeenAt"}…], "online", "total"}`.
- Human, no devices: `No phones are linked to your account yet. Install the SMSTunnel app on your Android phone and sign in: https://play.google.com/store/apps/details?id=io.smstunnel.app`
- Human, else a table, an empty line, then `<online> of <count> online. Send from one with --phone <id or name>.`
  (both counted from the list).

Table: header `ID`, `NAME`, `STATUS`, `LAST SEEN`; one row per phone in server order: id, name, `online`/`offline`, and
`now` when online, else the time since `lastSeenAt` (section 6.6; `never` when missing). Every column but the last is
padded with spaces to its widest cell, columns are joined by two spaces, the last column is not padded, no trailing
spaces. Widths count UTF-16 code units [NODE: `String.length`; **[PORT]**: count UTF-16 units to match].

```
ID                        NAME         STATUS   LAST SEEN
aaaaaaaaaaaaaaaaaaaaaaaa  Store phone  online   now
bbbbbbbbbbbbbbbbbbbbbbbb  Old Samsung  offline  4 days ago
```

### 5.4 `smstunnel send <number> <message…>` and `smstunnel code <number> <message…>`

`code` is `send` for sign-in codes: other route, other limit, and the code check.

Arguments: the first is the number, the rest are the words of the text, joined with single spaces. The text comes from
stdin when the words are exactly `-`, or when there are no words and stdin is not a terminal; then all of stdin is read
(UTF-8; more than 65,536 bytes: exit 2, `The text on standard input is too long.`). In every case `\r\n` becomes `\n` and
the newlines at the end are removed.

Checks, in this order (each a usage error, exit 2, nothing sent):

1. The number (section 6.1).
2. The text, after reading it. Blank (only whitespace or empty):
   - send: `Write the message, like: smstunnel send +40712345678 "See you at 10"`
   - code: `Write the text with the code, like: smstunnel code +40712345678 "Your sign-in code is 482913"`
3. Length in Unicode code points (section 6.4) above 1600 (send) / 320 (code):
   `The text has <n> characters; a text can have up to 1600.` /
   `The text has <n> characters; a sign-in code text can have up to 320.`
4. code only, no sign-in code in the text (section 6.3):
   `The text must contain the code: 4 to 10 digits standing on their own (482913) or two groups of 3 joined by a dash (482-913). Texts without a code go through "smstunnel send".`
5. `--country` (section 6.2).
6. `--timeout` value: not a positive number of seconds (6.5): `--timeout takes a number of seconds, like --timeout 60.`
7. `--timeout` without `--wait`: `--timeout goes with --wait.`
8. `--idempotency-key`: trimmed, 1 to 255 characters, all printable ASCII (U+0020 to U+007E), else
   `--idempotency-key takes 1 to 255 printable ASCII characters (letters, digits and signs such as - _ . :), like --idempotency-key order-1042-ready. A UUID is a good choice.`
   (spaces inside are allowed; the trimmed value is sent).
9. The key (3.2), exit 3 when there is none.
10. `--phone` (section 6.7), which may call `GET /devices`.

Request: `POST /sms/send` (send) or `POST /sms/send-2fa` (code), body with exactly these members, in this order:
`{"to": <number as typed, trimmed>, "message": <text>}` plus `"deviceId"` (from `--phone`) and `"defaultCountryCode"`
(from `--country`, as typed without spaces) when given. Header `Idempotency-Key: <key>` when `--idempotency-key` is
given. For texts the CLI calls only `/sms/send` and `/sms/send-2fa`, one number per request.

The answer: `messageId` is the top-level `messageId`, else `data.messageId`; none: exit 1,
`SMSTunnel took the text but sent back no message id. Check the Messages page in your dashboard (https://dashboard.smstunnel.io) before you send it again.`
`queued` is the top-level `queued` when present, else `data.queued` (as a boolean). `branded` is `data.branded` (as a
boolean). `replayed` is true when the answer had the header `Idempotent-Replayed: true` (case-insensitive, trimmed).
`parts` is the estimate of section 6.4. `remaining` is `data.remaining` or `null`.

**Without `--wait`**, exit 0:

- JSON: `{"messageId", "queued", "branded", "replayed", "parts", "remaining", "result": "queued" | "handed-over", "status": null}`
  (`result` is `queued` when `queued` is true).
- Human, stdout:
  1. replayed only: `Already handed over with this --idempotency-key: SMSTunnel gave back its answer to the first request and did not send the text again.`
  2. queued: `Queued: none of your phones is online right now. The text goes out when your phone is back online (within 3 days).`
     else: `Handed to your phone, which sends it from your number.`
  3. `Message id: <id>. Check it with: smstunnel status <id>`, or with 2 or more parts
     `Message id: <id> (<parts> parts). Check it with: smstunnel status <id>`
  4. branded only: `Free plan: a short line was added to this text.`

**With `--wait`** (timeout default 120 seconds):

- Human, before waiting, stderr: the replayed line (as above) when replayed, then
  - queued: `Queued (message id <id>): none of your phones is online right now. Waiting up to <timeout> s… (Ctrl+C stops waiting; the text still goes out)`
  - else: `Handed to your phone (message id <id>). Waiting up to <timeout> s for it to be sent… (Ctrl+C stops waiting)`
  (`<timeout>` printed as the number given, such as `120`, `1.5`).
- Waiting (6.8) ends with `sent`, `unconfirmed`, `failed`, `still-waiting` or `interrupted`.
- JSON: `{"messageId", "queued", "branded", "replayed", "parts", "remaining", "result": <outcome>, "status": <the last status data or null>}`.
- Human:
  - sent → stdout `Sent by your phone at <local time>. Message id: <id>` (` at <local time>` only when `sentAt` is set),
    then the branded line when branded;
  - unconfirmed → stdout `Not confirmed by your phone: it handed the text to the SIM, so it was most likely sent. Don't send it again. Message id: <id>`
  - failed → stderr `Not sent: <errorMessage, or "your phone could not send it">. Message id: <id>`
  - still-waiting → stderr `Still waiting for your phone after <timeout> s[ (it is offline)]. The text goes out when your phone is back online; don't send it again. Check it later with: smstunnel status <id>`
    (` (it is offline)` when the send answer said queued)
  - interrupted → stderr `Stopped waiting. The text is still on its way; check it with: smstunnel status <id>`
- Exit: sent 0, unconfirmed 0, failed 8, still-waiting 9, interrupted 130.

The CLI never sends a text again by itself, whatever happens.

### 5.5 `smstunnel status <message-id>`

- Not exactly one argument: exit 2, `Give one message id: smstunnel status <message-id>`
- The id, trimmed, must be 24 hexadecimal characters (either case), else exit 2,
  `A message id has 24 characters, 0-9 and a-f: the one "smstunnel send" printed.`
- `GET /sms/status/<id>`. No `data`: exit 2, `SMSTunnel sent back no status.`
- JSON: `data` as sent (`{"id", "phoneNumber", "status", "deliveryStatus", "unconfirmed"?, "sentAt"?, "deliveredAt"?, "errorMessage"?}`).
- Human, stdout: the sentence below, then `To: <phoneNumber>` when there is one, then `Message id: <data.id, else the id given>`.

The sentence (`describeStatus`), first match:

1. `unconfirmed` is true or `deliveryStatus` is `unconfirmed`:
   `Not confirmed by your phone: it handed the text to the SIM, so it was most likely sent. Don't send it again.`
2. `status` `sent`: `Sent by your phone at <local time of sentAt>.` (or `Sent by your phone.` without `sentAt`)
3. `status` `delivered`: `Delivered at <local time of deliveredAt>.` (or `Delivered.`)
4. `status` `failed`: `Not sent: <errorMessage, or "your phone could not send it">.`
5. `status` `pending`: `Waiting for your phone to send it. If your phone is offline, the text goes out when it is back online (within 3 days).`
6. otherwise: `Status: <status>.`

Exit 0.

### 5.6 `smstunnel received`

Checks, in this order (exit 2):

1. Any argument: `"smstunnel received" takes no arguments; use --since, --from, --phone or --limit.`
2. `--since` (6.6): `--since takes a date (2026-11-03 or 2026-11-03T08:00:00Z) or a span back from now (30m, 2h, 1d).`
3. `--limit`: digits only, 1 to 100 (default 20): `--limit takes a number from 1 to 100.`
4. `--interval` value: a number of seconds (6.5) of at least 3 (default 10): `--interval takes a number of seconds, at least 3.`
5. `--interval` without `--watch`: `--interval goes with --watch.`

Then the key, then `--phone` (6.7, operation `received`). `--from` is trimmed.

Request: `GET /sms/received` with the query, in this order and only when set (not empty): `limit`, `since` (ISO 8601 in
UTC with milliseconds, `2026-11-03T08:00:00.000Z`), `phone` (from `--from`), `deviceId` (from `--phone`).

**Without `--watch`**, exit 0:

- JSON: `data` as the server sent it (newest first, `{"messages": […], "total", "page", "limit", "hasMore"}`), or
  `{"messages": [], "total": 0, "page": 1, "limit": <limit>, "hasMore": false}` when missing.
- Human: the texts oldest first (by `receivedAt`), one line each (below). None:
  `No received texts[ since <local time of --since>]. Your phone syncs received texts only after "Sync received texts" is turned on in the SMSTunnel app, and only those that arrive after that.`
  When `hasMore`: stderr `Showing the latest <shown> of <total>. Use --limit (up to 100) or --since to see others.`

One line: `<local time of receivedAt>  <sender>[  (<deviceName>)]  <words>` (two spaces between parts), where words is
`[encrypted]` when `isEncrypted` is true or `message` is `null`, else the message with every run of whitespace around a
line break (`\s*\r?\n\s*`) replaced by ` / `.

**With `--watch`**: print the texts of the first request oldest first (JSON: one compact object per line, as the server
sent it; human: the line above), then (human only) stderr `Watching for new texts every <interval> s… (Ctrl+C stops)`.
Then repeat until Ctrl+C:

1. Wait the pace (`--interval` seconds, or `SMSTUNNEL_POLL_INTERVAL_MS`), or the delay set by an error.
2. Ctrl+C: exit 0.
3. Ask again with `since` = the later of `--since` and (the start of the previous successful request − 5 minutes).
4. Print the texts whose `id` was not printed before, oldest first. Up to 5000 ids are remembered (the oldest are forgotten).
5. Errors: 429 → wait the larger of the pace and `Retry-After` (30 s when missing), no message. No answer, a timeout or a
   5xx → stderr `<the message of section 7> Trying again in <n> s.` with n = min(60, 2 × pace in seconds), and wait that
   long. Any other error ends the command with that error's message and exit code.

The first request's errors end the command (section 7).

### 5.7 `smstunnel usage`

- Any argument: exit 2, `"smstunnel usage" takes no arguments.`
- `GET /account/usage`. JSON: `data` as sent (or `{}`).
- Human, stdout, these lines in order (a line is left out when both its used and its left values are missing):
  1. `Plan: <plan or ->[ (shared with <enterprise.name>)]`
  2. `Texts today: <usage.smsClean> used, <remaining.smsClean> left[ (of <limits.smsClean>)]`
  3. only when `limits.smsCleanPerMonth` is present and not `unlimited`: `Texts this month: <usage.smsCleanMonth> used, <remaining.smsCleanMonth> left[ (of <limits.smsCleanPerMonth>)]`
  4. only when `limits.smsBrandedPerDay` is present and not `0`: `Texts with the free line today: <usage.smsBranded> used, <remaining.smsBranded> left[ (of <limits.smsBrandedPerDay>)]`
  5. `Sign-in codes today: <usage.twoFaClean> used, <remaining.twoFaClean> left[ (of <limits.twoFaClean>)]`

  On every line: a missing or `null` value prints `-`; ` (of <limit>)` is added only when that limit is present, not
  `null` and not `unlimited`; lines 2 to 5 are left out when both their used and their left values are absent
  (`undefined`; a `null` counts as present).
- Exit 0.

## 6. Shared rules

### 6.1 Numbers (`checkRecipient`)

The value is trimmed, then the first rule that applies:

1. Empty: `Give the number to text, like +40712345678.`
2. Contains `,` `;` `|` `&`, a line feed, a carriage return or a tab: `One number per text.`
3. More than one `+`: `One number per text.`
4. One `+` that is not the first character: `Put the + only at the start of the number, like +40712345678.`
5. More than 17 ASCII digits: `That looks like more than one number. One number per text.`
6. An ASCII letter: `"<value>" is not a phone number: write it with digits, like +40712345678.`
7. Not 7 to 25 characters of digits, whitespace, `.`, `-`, `(`, `)`, `+` (`^[\d\s.\-()+]{7,25}$`, `\s` as in JavaScript),
   or fewer than 6 digits: `Write the number with 7 to 25 characters: digits, spaces, dots, dashes, brackets and a leading +, like +40712345678.`
8. Accepted: the trimmed value is sent as is (SMSTunnel completes numbers without `+` or `00` with the country code).

### 6.2 Country codes (`--country`)

All whitespace is removed, then it must match `^(\+|00)?[1-9]\d{0,3}$` (`+40`, `40`, `0040`, `1`, `+353`); that value is
sent as `defaultCountryCode`. Else exit 2,
`Give the country calling code in digits, like --country +40 or --country 44 (not letters such as RO).`

### 6.3 Sign-in codes (`code`)

The text holds a code when one of these JavaScript regular expressions matches:

```
/(?<![\w+]|\d[.,:/])\d{4,10}(?!\w|[.,:/]\d)/
/(?<![\w+-]|\d[.,:/])\d{3}-\d{3}(?!\w|-\d|[.,:/]\d)/
```

That is: 4 to 10 digits not preceded by a word character, a `+`, or a digit followed by `.`, `,`, `:` or `/`, and not
followed by a word character or by `.`, `,`, `:`, `/` and a digit; or `123-456` with the same rules (and no dash before,
no `-digit` after). `\w` is `[A-Za-z0-9_]`. **[PORT]**: Go's `regexp` has no look-behind; implement the same rules by hand.
Codes: `123456`, `Code: 1234`, `Code:1234`, `G-123456`, `12-345678`, `123-456`, `2026`, `123456 is your code`. Not codes:
`hello there`, `A1B2C3`, `ORD12345 has shipped`, `12345678901`, `Call +40712345678`, `Pi is 3.14159`,
`See you on 01/11/2026`, `Meet at 10:30`, `123`, the empty text.

### 6.4 Length and SMS parts

The limits (1600, 320) count **Unicode code points** (an emoji is 1). [NODE: `Array.from(text).length`.]

The parts estimate (`parts` in the output):

- empty text: 0 parts;
- every code point in the GSM 03.38 basic set counts 1, every one in the extension set counts 2; one code point outside
  both makes the text UCS-2;
- GSM-7: 160 units or fewer → 1 part, else ceil(units / 153);
- UCS-2: 70 UTF-16 code units or fewer → 1 part, else ceil(units / 67) (an emoji takes 2 units).

Basic set (exactly these characters, including line feed and carriage return):
`@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà`.
Extension set: form feed, `^`, `{`, `}`, `\`, `[`, `~`, `]`, `|`, `€`.

### 6.5 Seconds (`--timeout`, `--interval`)

Trim, remove one trailing `s` or `S`, then it must be digits with an optional decimal part (`^\d+(\.\d+)?$`) and above 0:
`60`, `5s`, `1.5` are taken; `0`, `-1`, `abc`, an empty value are not.

### 6.6 Times

- `--since`: trimmed. `<n><unit>` with optional spaces between, unit `s`, `m`, `h`, `d` or `w` in either case
  (`90s`, `30m`, `2h`, `1d`, `1w`, ` 2H `) → now minus that. Else it must start with `YYYY-MM-DD` and parse as a date
  [NODE: `Date.parse`]: a date alone is **midnight UTC**; a date and time without an offset is **local time**; with `Z` or
  an offset, as given. Refused: `yesterday`, `2h ago`, `-1h`, `2026-13-45`, `12`, empty.
- Local times print as `YYYY-MM-DD HH:MM` (24-hour, zero-padded) in the computer's time zone; a missing value prints `-`;
  a value that isn't a date prints as given.
- Time ago (phones): missing → `never`; not a date → as given; seconds = round(now − then); below 60 (or in the future)
  → `just now`; minutes = round(seconds / 60), below 60 → `<m> min ago`; hours = round(minutes / 60), below 48 →
  `<h> h ago`; else `<round(hours / 24)> days ago`.

### 6.7 Choosing a phone (`--phone`)

Trimmed. 24 hexadecimal characters, or a UUID (8-4-4-4-12 hex): used as the phone id with no request. Otherwise
`GET /devices`, then the phones whose name equals it exactly, else equals it ignoring case:

- one: its id;
- several: exit 2, `Several of your phones are called "<value>". Use the id instead (see "smstunnel phones").`
- none, no phones at all: exit 2, `No phones are linked to your account yet.`
- none: exit 2, `No phone called "<value>". Your phones: "<name>", "<name>". "smstunnel phones" shows their ids.`

### 6.8 Waiting (`--wait`)

Deadline = start + timeout. Pace = 2000 ms (or `SMSTUNNEL_POLL_INTERVAL_MS`). Loop:

1. Sleep min(pace, time left). Ctrl+C during the sleep (or before it) → outcome `interrupted`. Ctrl+C during a request
   lets that request finish: a final state in its answer still wins, otherwise the next sleep returns `interrupted`
   at once.
2. `GET /sms/status/<id>`. With `data`: outcome when final (below), else keep waiting. Errors:
   - 429: also sleep min(`Retry-After` (5 s when missing), time left);
   - no answer, a timeout or a 5xx: count it; the 3rd in a row ends the command with exit 7 and
     `<message of section 7> The text was handed over (message id <id>); check it later with: smstunnel status <id>`;
   - anything else (401, 403, 404…): ends the command with that error's exit code and
     `<message of section 7> The text itself was handed over (message id <id>): don't send it again.`
   (both with `messageId` in the JSON details).
3. Time is up: outcome `still-waiting`.

Final states: `unconfirmed` (`unconfirmed` true or `deliveryStatus` `unconfirmed`, checked first); `sent` (`status`
`sent` or `delivered`); `failed` (`status` `failed`). `pending` and anything else keep waiting.

Ctrl+C is caught while waiting and watching, so the process ends with the exit code above instead of dying.

## 7. Requests and errors

### 7.1 Requests

Headers on every request: `X-API-Key: <key>`, `Accept: application/json`,
`User-Agent: smstunnel-cli/<VERSION> (<runtime>; <platform>)` [NODE: `(node v22.13.1; win32)`; **[PORT]**: keep the
`smstunnel-cli/<VERSION> (` prefix, e.g. `(go1.25.0; windows)`]. With a body: `Content-Type: application/json` and
`Content-Length`. `Idempotency-Key` only on sends with `--idempotency-key`. Never `Authorization`; the key never goes in
a URL. Bodies are compact JSON in UTF-8.

Per request: no answer within 30 seconds → timeout [NODE: socket inactivity timeout]. Answers larger than 5 MiB are
dropped (a network error). Redirects are not followed.

A send "may have arrived" when the request was completely written before the failure and the failure is not one of
these (which happen before anything reaches SMSTunnel): `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`,
`ENETUNREACH`, `EADDRNOTAVAIL`, `CERT_HAS_EXPIRED`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`,
`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `ERR_TLS_CERT_ALTNAME_INVALID`
[NODE error codes; **[PORT]**: map DNS, refused-connection and TLS errors to "never arrived"].

Answers:

- 3xx: a redirect error.
- below 200 or 400 and above: an HTTP error, with `code` and `permission` from the JSON body (when strings),
  `Retry-After` (7.3) and the replay header.
- 2xx whose body is not a JSON object: an "invalid response" error.
- 2xx with `"success": false`: an HTTP error with that 2xx status.

The server's words for an error (`<said>` below): a `message` list → its non-empty strings joined with `; `; else
`message` trimmed; else `error` trimmed; else the body text when it is 300 characters or fewer and doesn't start with
`<`; else `HTTP <status>`.

### 7.2 Messages and exit codes (`describeApiError`)

`<host>` is the host (and port) of the API address. "A send" is `send` or `code`. "With a key" means the send carried
`--idempotency-key`. First match:

| Case | Exit | Message |
|---|---|---|
| no answer / timeout, a send that may have arrived, with a key | 7 | `The connection to SMSTunnel broke after the text was handed over, so it may have gone out. Run the same command again with the same --idempotency-key: SMSTunnel will not send the text twice.` |
| same, without a key | 7 | `The connection to SMSTunnel broke after the text was handed over, so it may have gone out. Check the Messages page in your dashboard (https://dashboard.smstunnel.io) before you send it again.` |
| no answer / timeout, otherwise | 7 | `Could not reach SMSTunnel at <host> (<why>). Check your internet connection and try again.` — why: `no answer in time` for a timeout, else the system error code (such as `ECONNREFUSED`) or message |
| redirect | 7 | `<host> answered with a redirect (HTTP <status>). Check the API address (--api-base).` |
| invalid response | 7 | `Unexpected answer from <host> (HTTP <status>): it is not the SMSTunnel API. Check the API address (--api-base).` |
| 400 | 2 | `SMSTunnel refused the request: <said>` |
| 401 | 3 | `SMSTunnel refused the API key<from>: it is wrong, deactivated or deleted. Create a key in your dashboard (https://dashboard.smstunnel.io → Apps → Add an app)<next>` — from: ` (the key in SMSTUNNEL_API_KEY)` for the variable, nothing for the key typed at login, ` (the saved key)` otherwise; next: `.` at login or for the variable, else `, then run "smstunnel login" again.` |
| 403, `PERMISSION_REQUIRED`, `sms:inbox` | 4 | `This API key may not read received texts. In your dashboard (https://dashboard.smstunnel.io → Apps), choose "Allow reading received texts" for this key, or add an app with "Can also read received texts" ticked. Your phone also needs "Sync received texts" turned on in the SMSTunnel app; only texts that arrive after that are synced.` |
| 403, `PERMISSION_REQUIRED`, `sms:send` | 4 | `This API key may not send texts (it lacks the "sms:send" permission). Create a key in your dashboard (https://dashboard.smstunnel.io → Apps → Add an app).` |
| 403, `PERMISSION_REQUIRED`, `sms:read` | 4 | `This API key may not check whether texts went out (it lacks the "sms:read" permission). Create a key in your dashboard (https://dashboard.smstunnel.io → Apps → Add an app).` |
| 403, `PERMISSION_REQUIRED`, other | 4 | `This API key lacks the "<permission, or needed>" permission. <said>` |
| 403, other | 4 | `SMSTunnel refused this: <said>` |
| 404, `status` | 5 | `No text with that id for this key.` |
| 404, a send or `received` | 5 | `<said>. List your phones and their ids with "smstunnel phones".` |
| 404, other | 5 | `Not found: <said>` |
| 422, `IDEMPOTENCY_KEY_REUSED` | 2 | `This --idempotency-key was already used in the last 24 hours for a different text (another number, message, phone or country code, or "code" instead of "send"). Nothing was sent. Use a new key for a new text.` |
| 409, `IDEMPOTENCY_KEY_IN_PROGRESS` | 6 | `SMSTunnel is still handling an earlier request with this --idempotency-key. Run the same command again in <n> second[s] to get its answer; it will not send a second text.` — n = max(1, `Retry-After`, 1 when missing); `second` when n is 1 |
| 429 with `Retry-After` | 6 | a send: `Too many texts in a minute: SMSTunnel takes up to 30 send requests a minute. Try again in <n> second[s].`; other: `Too many requests in a minute. Try again in <n> second[s].` — n = max(1, Retry-After) |
| 429 without it | 6 | `<said>`, or `Your plan's allowance for today is used up.` when said is empty or `HTTP <n>` |
| 5xx, a send | 7 | `<first><then>` — first: `SMSTunnel had a problem (HTTP <status>) with the first request that used this --idempotency-key, and gives that same answer for 24 hours. ` when the answer was replayed, else `SMSTunnel had a problem (HTTP <status>). `; then, with a key: `The text may or may not have been taken: check the Messages page in your dashboard (https://dashboard.smstunnel.io). Running the command again with the same key gets this answer again; use a new key only once you know the text did not go out.`, without: `The text may or may not have been taken: check the Messages page in your dashboard (https://dashboard.smstunnel.io) before you send it again.` |
| 5xx, other | 7 | `SMSTunnel had a problem (HTTP <status>). Try again in a little while.` |
| anything else (409 or 422 without those codes, a 2xx with `success: false`…) | 1 | `SMSTunnel refused the request (HTTP <status>): <said>` |

JSON details of these errors: `status`, `code`, `permission`, `retryAfter` as received.

### 7.3 Retry-After

Digits → that many seconds; otherwise an HTTP date → max(1, ceil((date − now) / 1 s)); anything else → not set. With
several values, the first.

### 7.4 Idempotency-Key (server behaviour the CLI relies on)

`POST /sms/send` and `/sms/send-2fa` with `Idempotency-Key`: the first request runs; the same key with the same request
(route and body) within 24 hours gets the stored answer (same status and body) with `Idempotent-Replayed: true` and no
new text; the same key with a different request gets 422 `IDEMPOTENCY_KEY_REUSED`; while the first is still running,
409 `IDEMPOTENCY_KEY_IN_PROGRESS` with `Retry-After: 1`. 2xx and 5xx answers are stored, a 4xx frees the key. Keys are
per API key. The CLI only passes the header through and reports these answers; it never retries.

## 8. Exit codes

| Code | Meaning |
|---|---|
| 0 | Done (also a text "not confirmed by your phone", and Ctrl+C in `received --watch`) |
| 1 | Something unexpected (any HTTP refusal not listed, a missing message id, `config.json` unreadable or invalid) |
| 2 | Invalid arguments; 400; 422 `IDEMPOTENCY_KEY_REUSED` |
| 3 | No API key; 401; the saved key is missing from the system store |
| 4 | 403 |
| 5 | 404 |
| 6 | 429; 409 `IDEMPOTENCY_KEY_IN_PROGRESS` |
| 7 | No answer, a timeout, a redirect, not the SMSTunnel API, or a 5xx |
| 8 | `--wait`: the text failed |
| 9 | `--wait`: still waiting when the time was up |
| 130 | `--wait` stopped with Ctrl+C; Ctrl+C at the key prompt |

## 9. Help texts

`smstunnel`, `smstunnel --help`, `smstunnel help` and `smstunnel help <unknown>` print the main help (with `VERSION` and
the constants filled in); `smstunnel <command> --help` and `smstunnel help <command>` print the command's help. Each is
followed by `\n`.

### Main help

```
smstunnel 1.0.0: send texts from your computer through your own Android phone and number.

Usage: smstunnel <command> [options]

Commands:
  login                       Save your API key (from https://dashboard.smstunnel.io → Apps → Add an app)
  logout                      Remove the saved key from this computer
  phones                      List your phones and which are online
  send <number> <message…>    Hand a text to your phone, which sends it from your number
  code <number> <message…>    Send a sign-in code (the text must contain the code)
  status <message-id>         Where a text is now
  received                    Texts your phone received (needs a key allowed to read them)
  usage                       Your plan, today's usage and what is left

Options for every command:
  --json                Print JSON (errors go to stderr, as JSON too)
  --api-base <url>      API address (default https://smstunnel.io/api/v1)
  -h, --help            Help for a command, like: smstunnel send --help
  -v, --version         Print the version

Environment:
  SMSTUNNEL_API_KEY     A key to use instead of the saved one
  SMSTUNNEL_API_BASE    The API address, like --api-base

One number per text: each text goes to one recipient.

Exit codes:
  0  done (a text not confirmed by the phone counts as sent: don't send it again)
  1  something unexpected
  2  invalid arguments, or SMSTunnel refused the input (400; 422: --idempotency-key used for another text)
  3  no API key, or SMSTunnel refused it (401)
  4  the key or your plan doesn't allow it (403)
  5  not found (404)
  6  too many requests, or today's allowance is used up (429); 409: --idempotency-key still in progress
  7  SMSTunnel could not be reached or had a problem (5xx)
  8  the text failed (send --wait)
  9  still waiting for your phone when --wait gave up
130  stopped waiting with Ctrl+C (--wait); Ctrl+C ends received --watch with 0
```

### `login`

```
Usage: smstunnel login

Asks for your API key (hidden while you paste it), checks it with SMSTunnel and saves it:
in your macOS Keychain, Windows Credential Manager or Linux keyring (Secret Service) when there
is one, otherwise in a file only your user account can read.

Get a key in your dashboard: https://dashboard.smstunnel.io → Apps → Add an app. It is shown only once.
To pipe it in instead: echo "$SMSTUNNEL_KEY" | smstunnel login
```

### `logout`

```
Usage: smstunnel logout

Removes the saved key from this computer. The key keeps working until you deactivate or
delete it in your dashboard (Apps).
```

### `phones`

```
Usage: smstunnel phones [--json]

Lists the phones linked to your account, which are online, and their ids for --phone.
```

### `send`

```
Usage: smstunnel send <number> <message…> [options]

Hands a text to your phone, which sends it from your number. One number per text.
With no message, or "-", the text is read from standard input.

Options:
  --phone <id or name>  Which of your phones sends it (default: your default phone)
  --country <code>      Country code for a number written without + or 00, like +40
  --wait                Wait until your phone sent it (or it failed)
  --timeout <seconds>   How long --wait waits (default 120)
  --idempotency-key <key>
                        Run the same command again with the same key (within 24 hours) and
                        SMSTunnel gives back the first answer instead of sending a second text

Examples:
  smstunnel send +40712345678 "Your order is ready for pickup"
  smstunnel send 0712345678 --country +40 --phone "Store phone" --wait "See you at 10"
  echo "Backup finished" | smstunnel send +40712345678
  smstunnel send +40712345678 "Order 1042 is ready" --idempotency-key order-1042-ready

Texts go out in the order you send them, up to 1600 characters each. If none of your phones is
online, the text waits and goes out when one is back online (within 3 days).
```

### `code`

```
Usage: smstunnel code <number> <message…> [options]

Sends a sign-in code you generated, from your own phone. The text must contain the code:
4 to 10 digits on their own (482913) or two groups of 3 joined by a dash (482-913), up to
320 characters. Codes have their own daily allowance.

Options: --phone, --country, --wait, --timeout and --idempotency-key, as for "smstunnel send".

Example:
  smstunnel code +40712345678 "Your sign-in code is 482913. It expires in 5 minutes."
```

### `status`

```
Usage: smstunnel status <message-id> [--json]

Where a text is now: waiting for your phone, sent, or not sent (and why).
```

### `received`

```
Usage: smstunnel received [options]

Texts your phone received after you turned on "Sync received texts" in the SMSTunnel app.
The key must be allowed to read them: in your dashboard, Apps → "Allow reading received texts"
(or "Can also read received texts" when you add the app).

Options:
  --since <when>        A date (2026-11-03, 2026-11-03T08:00:00Z) or a span back from now (30m, 2h, 1d)
  --from <number>       Only texts from this number
  --phone <id or name>  Only texts one of your phones received
  --limit <n>           How many, 1 to 100 (default 20)
  --watch               Keep printing new texts as they arrive (Ctrl+C stops)
  --interval <seconds>  How often --watch checks (default 10, at least 3)
```

### `usage`

```
Usage: smstunnel usage [--json]

Your plan, how many texts and sign-in codes you used today and how many are left.
```

## 10. Test cases the port must pass

From `test/unit`, `test/e2e/mock.e2e.test.mjs` (against `test/e2e/mock-server.mjs`) and `test/e2e/dev-api.e2e.test.mjs`
(against a local SMSTunnel API). The end-to-end tests run the built CLI as a child process with stdin closed, a temporary
`SMSTUNNEL_CONFIG_DIR`, `SMSTUNNEL_KEY_STORE=file` and `SMSTUNNEL_POLL_INTERVAL_MS=100`; the mock server can be reused
as is against a Go binary.

Arguments:
1. `send --wait +40712345678 Hello there --phone "Store phone"` → positionals `send +40712345678 Hello there`, options wait, phone.
2. `--api-base=http://localhost:3101` and `--api-base http://localhost:3101` are the same.
3. After `--`, `--wait is part of the text` are positionals.
4. `-20%`, `today`, `-`, `only` stay positionals.
5. `-h` is help, `-v` is version.
6. `phones --loud` → exit 2, `Unknown option --loud`.
7. `send --phone` (no value), `send --phone --wait`, `send --phone=` → exit 2, `needs a value`.
8. `send --wait=yes` → exit 2, `takes no value`.
9. `--phone a --phone b` → `b`.

Numbers and codes:
10. Taken as typed (trimmed): `+40712345678`, `0712 345 678`, `(0721) 123-456`, `0040712345678`, `+1 415.555.0123`, ` +40712345678 `.
11. `One number per text.` for `+40712345678,+40722333444`, `0712345678; 0722333444`, `+40712345678 +40722333444`, `0712345678|0722333444`, `0712345678 & 0722333444`, `0712345678\n0722333444`.
12. `more than one number. One number per text.` for `0712345678 0722333444`, `0712345678/0722333444`, `0712345678 or 0722333444`.
13. `0721-CALL-ME` → not a phone number; `12345` → 7 to 25 characters; `0721+123456` → + only at the start; empty / missing → Give the number; `0151/2345678` → 7 to 25 characters.
14. Country codes taken: `+40`, `40`, `0040`, `1`, `+1`, `+353`, ` +44 `; refused: `RO`, `DE`, `+40a`, `0`, `+`, `+12345`, empty, missing.
15. Sign-in code examples of 6.3 (both lists); a non-string is never a code.
16. Parts: `''` → GSM-7, 0 chars, 0 parts; `Hello` 1; 160 × `a` 1; 161 → 2; 306 → 2; 307 → 3; 80 × `€` 1, 81 → 2; `{}[]~^|\` GSM-7; `Mulțumim, ș și ț` UCS-2; 70 × `ș` 1, 71 → 2, 134 → 2, 135 → 3; `😀` UCS-2 with 1 character; `abc` 3, `😀😀` 2, `ăîâșț` 5.

Times:
17. `--since` at 2026-11-03T12:00:00Z: `90s` → 11:58:30, `30m` → 11:30, `2h` → 10:00, `1d` → 2026-11-02T12:00, `1w` → 2026-10-27T12:00, ` 2H ` → 10:00; `2026-11-03T08:00:00Z` as is; `2026-11-03` is a date; refused: `yesterday`, `2h ago`, `-1h`, `2026-13-45`, `12`, empty.
18. Time ago at 12:00:00Z: 11:59:30 → `just now`, 11:55 → `5 min ago`, 09:00 → `3 h ago`, 2026-10-30T12:00 → `4 days ago`, none → `never`.
19. Local time of `2026-11-03T08:05:00Z` matches `2026-11-0[23] \d{2}:05`; none → `-`; `not a date` → `not a date`.
20. Seconds: `60` → 60, `5s` → 5, `1.5` → 1.5; refused `0`, `-1`, `abc`, empty, missing.
21. Idempotency keys taken: `a`, `order-1042-ready`, a UUID, `with spaces inside`, `"quoted"`, 255 × `x`, `  padded  ` → `padded`; refused: empty, spaces only, missing, 256 × `x`, `commande-é`, a tab, an emoji, a line break.

Formatting:
22. API address normalisation and refusals of 3.1 (exit 2).
23. Masked keys: `sk_live_` + 32 hex → `sk_live_01…cdef`; `sk_short` → `sk_…`.
24. Final states: pending → keep waiting; sent, delivered → sent; failed → failed; failed + unconfirmed, or deliveryStatus unconfirmed → unconfirmed.
25. Status sentences: sent with sentAt matches `^Sent by your phone at 2026-11-0\d \d{2}:00\.$`; failed + `No signal` → `Not sent: No signal.`; unconfirmed → `…most likely sent. Don't send it again.`; pending starts with `Waiting for your phone`.
26. Usage lines for the free and pro examples (exact lists in `test/unit/format.test.mjs`).
27. Received line: `^2026-11-0\d \d{2}:05  \+40712345678  \(Store phone\)  See you \/ at 10$`; encrypted → ends with `[encrypted]`.
28. The phones table of 5.3, character for character.

Key store:
29. Config folder: `SMSTUNNEL_CONFIG_DIR` as is; Windows `%APPDATA%\smstunnel`; `XDG_CONFIG_HOME/smstunnel`; macOS `~/.config/smstunnel`.
30. File store: `config.json` is `{"keyStore":"file","apiKey":<key>}`, mode 0600 in a 0700 folder (POSIX), loads back as stored/file.
31. A non-default API address is saved with the key; a later save with the default removes it.
32. Unknown system → file with `no system keychain…`; Linux without secret-tool or D-Bus → secret-service not available → file with `is not available here`.
33. `SMSTUNNEL_API_KEY` (trimmed) wins over the saved key.
34. No saved key → none, and `config.json` reads as `{}`.
35. Logout removes the file and names it; a second logout removes nothing.
36. Keys refused with exit 2 and nothing written: `sk_live_"; rm -rf`, `short`, `sk live with spaces`, `sk_live_` + 300 × `a`.
37. Broken `config.json` → exit 1, `not valid JSON`.
38. `SMSTUNNEL_KEY_STORE=cloud` → exit 2; `file` → no system store; default on macOS → keychain, on Windows → credential manager; `SMSTUNNEL_KEYCHAIN_SERVICE=bad'name` → exit 2.

Errors (7.2): 39. every row of the table, including the exact messages pinned in `test/unit/errors.test.mjs` (network
before/after hand-over, 400 list joined, 401 three sources, 403 four permissions and plan, 404 three cases, 429 with
`Retry-After: 42` and `1`, 429 without, 5xx read/send, redirect, invalid response, other → 1, 422/409 idempotency, 5xx
with a key and replayed, Retry-After as seconds, array and HTTP date).

End to end (mock):
40. `--version` prints the package version; `--help` has `One number per text` and `Exit codes:`; `send --help` has `--wait`; `blast` → exit 2 `Unknown command "blast"`; no command → exit 2.
41. No key → exit 3, mentions `smstunnel login` and `dashboard.smstunnel.io → Apps → Add an app`.
42. Login with a refused key → exit 3, `refused the API key`, no `config.json`.
43. `login <key>` → exit 2 `shell history`; empty stdin → exit 2.
44. Login through stdin → `Signed in with sk_live_aa…aaaa. The key is saved in …`, `Your phones: Desk phone (online), Spare phone (offline)…`, stderr `Warning: SMSTUNNEL_KEY_STORE=file, so the key is saved in a file`, the key never printed, `config.json` = `{keyStore: file, apiBase, apiKey}` (0600); later commands use the saved key and address; `SMSTUNNEL_API_KEY` wins (refused → exit 3 naming it); logout → `Signed out: the key was removed from …`, no file, then exit 3.
45. `phones`: a header line matching `^ID\s+NAME\s+STATUS\s+LAST SEEN`, a row matching `a1a1a1a1a1a1a1a1a1a1a1a1  Desk phone\s+online\s+now`, `2 of 4 online`; `--json` has total 4.
46. `send +40712345678 Your order is ready` → the two lines of 5.4, body exactly `{to, message}`.
47. `--phone "desk PHONE"` (case-insensitive name) and `--country +40` → deviceId and defaultCountryCode in the body; `--phone <24-hex id>` used directly.
48. Refused before any send (exit 2, no request): lists, two numbers, `mom`, phone `Twin` (two phones), phone `Kitchen` (`No phone called "Kitchen". Your phones: "Desk phone", "Spare phone", "Twin", "Twin"`), `--country RO`, 1601 characters, no text, `--timeout 5` without `--wait`, no number; `phones --wait` → exit 2 not an option.
49. Text from stdin (`Backup finished\n` → `Backup finished`); `-` with `Line one\nLine two\n\n` → `Line one\nLine two`.
50. `--wait`: stderr `Handed to your phone (message id …). Waiting up to 120 s`, stdout `Sent by your phone at YYYY-MM-DD HH:MM. Message id: …`; `--wait --json` → result `sent`, queued false, status.deliveryStatus `sent`.
51. `--wait` failed → exit 8, `Not sent: Generic failure (the SIM refused it). Message id: …`; unconfirmed → exit 0 with the warning; a 429 during status is waited out; a 403 on status → exit 4 with `The text itself was handed over (message id …): don't send it again.`
52. Offline phone → `Queued: …(within 3 days).`; `--json` result `queued`; `--wait --timeout 1` → exit 9, `Still waiting for your phone after 1 s (it is offline). …don't send it again. Check it later with: smstunnel status …`
53. 429 with `Retry-After: 7` → exit 6, exactly `Too many texts in a minute: SMSTunnel takes up to 30 send requests a minute. Try again in 7 seconds.`; 429 without → exit 6 with the server's sentence; 403 plan → 4; 400 list → 2 `…7-25 characters; second problem`; 500 → 7 `may or may not have been taken`; connection dropped after the request → 7 `may have gone out. Check the Messages page`.
54. `--json` errors: stdout empty, stderr JSON with exitCode 3, status 401.
55. `code` without a code → 2; over 320 → 2; nothing sent; `code … 482913 --wait` → sent, to `/sms/send-2fa` with `{to, message}`.
56. `status <id>` → `Sent by your phone at ….\nTo: +40712345678\nMessage id: …\n`; `--json` status `sent`; unknown id → exit 5 `No text with that id for this key.`; `abc` → 2.
57. `received` oldest first, two lines; `--since 1h --from … --limit 5` → query limit `5`, phone, since ≈ now − 1 h, one line; bad `--since` or `--limit 0` → 2; send-only key → exit 4 with the dashboard words.
58. `received --watch --interval 3`: a text added while watching is printed once; stderr `Watching for new texts every 3 s`.
59. `usage` prints exactly the five free-plan lines.
60. `--api-base http://example.com/api/v1` → 2; a redirecting base → 7 `redirect`; an HTML base → 7 `not the SMSTunnel API`; `http://127.0.0.1:9/api/v1` → 7 `Could not reach SMSTunnel at 127.0.0.1:9`.
61. `--idempotency-key`: the header is sent; the same command again → stdout exactly the replay line, the handed-over line and the id line with the same id; `--json` → replayed true, same id, result `handed-over`; with `--wait` → stderr starts with the replay line, then sent; no second text; without the key → replayed false, no header.
62. The same key for another text → exit 2 with the exact 422 message; as JSON the code is `IDEMPOTENCY_KEY_REUSED`; no text.
63. A key still in progress → exit 6 with the exact 409 message.
64. Bad keys (256 characters, `commande-é`, spaces only) → exit 2 before any request; `phones --idempotency-key k` → 2.
65. `code --idempotency-key login-552211` → header on `/sms/send-2fa`.
66. 500 with a key → 7 with the "same key gets this answer again" sentence; again → the "first request that used this --idempotency-key" sentence; a dropped connection with a key → exactly the "Run the same command again" message.
67. Every request: no `sk_live` in any URL, texts only through `/sms/send` and `/sms/send-2fa`, `User-Agent` starts with `smstunnel-cli/<x.y.z> (`, no `Authorization`.

End to end (local SMSTunnel API, fake phone): 68. login through stdin; phones table and JSON; `send --wait --json`
→ sent; status of it; queued text with an offline phone → exit 9; `code --wait` → sent; the same `--idempotency-key`
twice → same message id, `replayed` false then true, one text stored, another text with that key → exit 2; received
(human and JSON); usage; a refused key → 3; a key without `sms:inbox` → 4; logout, then exit 3.

## 11. Points to keep in mind

- The 1600/320 limits count code points; SMSTunnel's own check counts UTF-16 units minus surrogate pairs and minus
  variation selectors (U+FE0E, U+FE0F). Near the limit, a text with variation selectors can be refused by the CLI though
  the server would take it. The port should keep the CLI's rule (it never lets through a text the server refuses).
- macOS uses `~/.config/smstunnel`, not `~/Library/Application Support`, for `config.json`.
- `SMSTUNNEL_API_KEY` is not checked against the key pattern; only `login` checks keys.
- The Node version needs no runtime dependencies; the port should not need any tool besides the system key stores.
