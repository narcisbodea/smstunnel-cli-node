# smstunnel

Send texts from your computer through your own Android phone and number.

`smstunnel` is the command-line tool for [SMSTunnel](https://smstunnel.io): you write a text in your terminal or a script, SMSTunnel hands it to your linked Android phone, and your phone sends it from your own number, on your own SIM and plan. It also checks whether a text went out, sends sign-in codes, lists the texts your phone received and shows what is left of your plan today.

- Zero dependencies: Node.js 18 or newer is all it needs.
- Your API key stays in your system keychain (macOS Keychain, Windows Credential Manager, the Linux Secret Service), or in a file only you can read.
- One number per text. Each text goes to one person: there are no lists of numbers or CSV imports.

The phone needs the SMSTunnel app from Google Play, signed in to your account:

<a href="https://play.google.com/store/apps/details?id=io.smstunnel.app"><img src="https://smstunnel.io/google-play-badge.png" alt="Get it on Google Play" height="56"></a>

Documentation: [smstunnel.io/docs](https://smstunnel.io/docs/) · Dashboard: [dashboard.smstunnel.io/apps](https://dashboard.smstunnel.io/apps)

## Install

```bash
npm install -g smstunnel
```

Or run it once without installing: `npx smstunnel phones`.

With Homebrew (macOS and Linux), once the tap is published:

```bash
brew install narcisbodea/tap/smstunnel
```

On Windows, install Node.js first if you don't have it (`winget install OpenJS.NodeJS.LTS`), then `npm install -g smstunnel`.

## Get your key

1. Install the [SMSTunnel app from Google Play](https://play.google.com/store/apps/details?id=io.smstunnel.app) on your Android phone and sign in. The phone shows up under **Phones** in your dashboard.
2. In your dashboard, [dashboard.smstunnel.io/apps](https://dashboard.smstunnel.io/apps), open **Apps → Add an app** and create the key. It is shown only once. It can send texts and look up whether they went out; reading received texts is a separate opt-in (**Can also read received texts**).
3. Run `smstunnel login`, paste the key when asked (it stays hidden) and press Enter.

```bash
smstunnel login
```

The CLI checks the key with SMSTunnel first and saves it only if it works:

| System | Where the key is saved |
|---|---|
| macOS | your Keychain (`security`), item "smstunnel" |
| Windows | Windows Credential Manager (through Windows PowerShell), item "smstunnel" |
| Linux | your keyring through the Secret Service (`secret-tool`), when it is installed and a desktop session is running |
| anything else | `~/.config/smstunnel/config.json` (`%APPDATA%\smstunnel` on Windows), readable only by you (mode 0600). The CLI says so with a warning. |

The key never goes on the command line. To pipe it in from a password manager: `pass show smstunnel | smstunnel login`.

`SMSTUNNEL_API_KEY`, when set, is used instead of the saved key (handy in CI). `smstunnel logout` removes the saved key from this computer; the key itself keeps working until you deactivate or delete it in your dashboard (Apps).

## Send a text

```bash
smstunnel send +40712345678 "Your order is ready for pickup"
```

```
Handed to your phone, which sends it from your number.
Message id: 6ae9952f7f9ac207c547af90. Check it with: smstunnel status 6ae9952f7f9ac207c547af90
```

- `--wait` waits until your phone sent it (or it failed), up to `--timeout` seconds (120 by default).
- `--phone <id or name>` picks which of your phones sends it (`smstunnel phones` lists them). Without it, your default phone sends it.
- `--country +40` is the country code for a number written without `+` or `00`: `0712 345 678` becomes `+40712345678`. Without it, SMSTunnel uses the country saved for your phone, then +40.
- `--idempotency-key <key>` makes the command safe to run again: within 24 hours, the same command with the same key gets the first answer back (the same message id) instead of sending a second text. Use one key per text, such as `order-1042-ready`.
- With no message, or `-`, the text is read from standard input: `echo "Backup finished" | smstunnel send +40712345678`.

```bash
smstunnel send 0712345678 --country +40 --phone "Store phone" --wait "See you at 10"
```

```
Handed to your phone (message id 6ae9952f7f9ac207c547af90). Waiting up to 120 s for it to be sent… (Ctrl+C stops waiting)
Sent by your phone at 2026-11-03 10:02. Message id: 6ae9952f7f9ac207c547af90
```

If none of your phones is online, the text is queued and goes out when your phone is back online (within 3 days). A text your phone handed to the SIM without getting the confirmation is reported as "not confirmed": it was most likely sent, so don't send it again.

One number per text: `smstunnel send "+40712345678,+40722333444" …` is refused with "One number per text."

Texts can have up to 1600 characters. Plain Latin text fits 160 characters in one SMS part; a text with characters such as ș, ț or emoji fits 70, and longer texts are split into parts by your phone.

## Send a sign-in code

```bash
smstunnel code +40712345678 "Your sign-in code is 482913. It expires in 5 minutes."
```

You generate and check the code yourself; the text must contain it, as 4 to 10 digits on their own (`482913`) or two groups of 3 joined by a dash (`482-913`), in up to 320 characters. Codes have their own daily allowance. `code` takes the same options as `send`.

## Check a text

```bash
smstunnel status 6ae9952f7f9ac207c547af90
```

```
Sent by your phone at 2026-11-03 10:02.
To: +14155550123
Message id: 6ae9952f7f9ac207c547af90
```

## Received texts

```bash
smstunnel received --since 2h
smstunnel received --watch
```

```
2026-11-03 10:02  +40755555555  (Store phone)  No problem, see you!
```

This lists the texts your phone received after you turned on "Sync received texts" in the SMSTunnel app (it is off by default; the phone's existing inbox is never read). The key must be allowed to read them: in your dashboard, **Apps**, choose **Allow reading received texts** for the key, or tick **Can also read received texts** when you add the app. Options: `--since` (a date such as `2026-11-03`, or `30m`, `2h`, `1d`), `--from <number>`, `--phone <id or name>`, `--limit` (up to 100), and `--watch` to keep printing new texts as they arrive (every `--interval` seconds, 10 by default; Ctrl+C stops).

To have received texts sent to your own server as they arrive instead, use **Apps → the key → Forward received texts** in your dashboard.

## Phones and usage

```bash
smstunnel phones
smstunnel usage
```

```
ID                        NAME             STATUS   LAST SEEN
6ae9940bf30ce9d1447cc179  Store phone      online   now
6ae9940bf30ce9d1447cc17a  Old Samsung      offline  4 days ago

Plan: pro
Texts today: 2 used, unlimited left
Sign-in codes today: 1 used, unlimited left
```

## In scripts

Every command takes `--json` and prints JSON on stdout; errors then go to stderr as JSON too (`{"error":{"message":…,"exitCode":…,"status":…}}`).

```bash
if smstunnel send "$MY_NUMBER" "Backup of $(hostname) finished" --wait --timeout 60; then
  echo "texted"
fi
```

A script that may run twice (a cron job, a CI retry) should give each text its own `--idempotency-key`: running it again then can't send the text twice.

```bash
smstunnel send "$CUSTOMER" "Order $ORDER is ready for pickup" --idempotency-key "order-$ORDER-ready"
```

Send only texts people expect from you: alerts to yourself, reminders, sign-in codes, replies they asked for.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. A text "not confirmed by your phone" also ends with 0: it was most likely sent, never send it again |
| 1 | Something unexpected |
| 2 | Invalid arguments, or SMSTunnel refused the input (HTTP 400), or the `--idempotency-key` was already used for a different text (HTTP 422) |
| 3 | No API key, or SMSTunnel refused it (HTTP 401) |
| 4 | The key or your plan doesn't allow it (HTTP 403), for example a key that may not read received texts |
| 5 | Not found (HTTP 404): an unknown message id or phone |
| 6 | Too many requests (HTTP 429 with `Retry-After`: the CLI says how many seconds to wait), today's allowance is used up (429 without it), or a request with the same `--idempotency-key` is still being handled (HTTP 409) |
| 7 | SMSTunnel could not be reached or had a problem (5xx). If a send broke after it left, the CLI says the text may have gone out: check before sending it again, or run the same command with the same `--idempotency-key` |
| 8 | The text failed (`send --wait` / `code --wait`) |
| 9 | Still waiting for your phone when `--wait` gave up. The text goes out when your phone is back online: don't send it again |
| 130 | You stopped `--wait` with Ctrl+C (the text is still on its way). Ctrl+C ends `received --watch` with 0 |

The CLI never resends a text by itself.

### Environment

| Variable | Use |
|---|---|
| `SMSTUNNEL_API_KEY` | A key to use instead of the saved one |
| `SMSTUNNEL_API_BASE` | The API address, like `--api-base` (default `https://smstunnel.io/api/v1`; `http://` only for localhost) |
| `SMSTUNNEL_KEY_STORE=file` | Save the key in the config file instead of the system keychain |
| `SMSTUNNEL_CONFIG_DIR` | Where `config.json` lives |

## Limits

Up to 30 send requests a minute per API key (the keys of one account together: 90), and 100 other requests a minute. How many texts and sign-in codes you can send a day depends on your plan: see [Pricing](https://smstunnel.io/pricing/) and `smstunnel usage`.

## Build it with an AI assistant

Paste this into Claude, ChatGPT, Cursor or Copilot, and replace the part in brackets. Never paste your real API key into a prompt.

```text
Write a script that sends texts with the SMSTunnel command-line tool. SMSTunnel sends each text from my own Android phone, from my own number: the phone runs the SMSTunnel app and is linked to my SMSTunnel account.

Setup: Node.js 18 or newer, then `npm install -g smstunnel`. The API key comes from the environment variable SMSTUNNEL_API_KEY (in CI, a secret), or from `smstunnel login`, which reads it from stdin and saves it in the system keychain.

Commands:
- smstunnel send <number> <text> [--phone <id or name>] [--country +40] [--wait [--timeout 120]] [--idempotency-key <key>] [--json]
- smstunnel code <number> <text> for sign-in codes only: the text must contain the code, 4 to 10 digits standing on their own (482913) or 123-456, at most 320 characters.
- smstunnel status <message id>, smstunnel phones, smstunnel usage, smstunnel received [--since 2h] [--watch]. Received texts need the key's "Can also read received texts" opt-in.
One number per command: to text several people, run it once per number. Numbers in international format (+14155550123); --country completes a number written without + or 00. Texts up to 1600 characters.
Behind it is the SMSTunnel API: POST https://smstunnel.io/api/v1/sms/send with the header X-API-Key and {"to", "message", "deviceId"?, "defaultCountryCode"?}, one recipient per call, 30 send requests a minute per key.
Exit codes: 0 done; 2 bad input (400) or an idempotency key reused for a different text; 3 key refused (401); 4 not allowed for this key or plan (403, with a code such as PERMISSION_REQUIRED); 5 not found; 6 too many requests (429: wait the seconds it says) or today's allowance used up; 7 SMSTunnel unreachable or a 5xx (the text may have gone out: don't resend blindly); 8 the text failed (--wait); 9 still waiting for the phone (--wait: it is offline, the text goes out when it is back; don't resend). With --json the result is JSON on stdout and errors are JSON on stderr: {"error":{"message","exitCode","status"}}.
If my phone is offline, the text waits in the queue and goes out when the phone is back online.

What I want: [describe what should send a text, to whom, and when]

Rules:
- Read the key from SMSTUNNEL_API_KEY or the saved login. Never write it in the script, never print it, never pass it as an argument.
- Validate each phone number before sending (international format, one number per command).
- Check the exit code of every command and handle the cases above. Give each text its own --idempotency-key (such as order-1042-ready) so a second run can't send it twice; never resend after exit 7 without the same key.
- Only send texts people expect (alerts to myself, reminders, sign-in codes, replies they asked for).
```

## Privacy

The CLI talks only to `https://smstunnel.io` (or the `--api-base` you give it), over HTTPS, with your key in the `X-API-Key` header. It sends no analytics. See the [privacy policy](https://smstunnel.io/privacy/).

## Responsible use

Send only texts that people expect from you: alerts to yourself, appointment reminders, sign-in codes, replies they asked for. Unsolicited messages from a personal SIM break most carriers' terms of service. Please make sure your usage complies with your carrier's terms and with local regulations (in the EU, that includes GDPR and ePrivacy rules on electronic communications).

## Development

```bash
npm install
npm test              # build, then the unit tests (node --test)
npm run test:e2e      # the built CLI against a local mock of the API
npm run test:dev-api  # the built CLI against a local SMSTunnel API (see below)
```

`test:dev-api` runs only when these are set, and only against a local API (never smstunnel.io): `SMSTUNNEL_E2E_API_BASE` (for example `http://127.0.0.1:3121/api/v1`), `SMSTUNNEL_E2E_KEY` (a throwaway key with `sms:send`, `sms:read` and `sms:inbox`), and optionally `SMSTUNNEL_E2E_SEND_ONLY_KEY`, `SMSTUNNEL_E2E_ONLINE_PHONE`, `SMSTUNNEL_E2E_OFFLINE_PHONE`, `SMSTUNNEL_E2E_NUMBER`, `SMSTUNNEL_E2E_EXPECT_RECEIVED` and `SMSTUNNEL_E2E_IDEMPOTENCY_KEY`. It sends 4 texts. The tests never touch your real keychain: they use `SMSTUNNEL_KEY_STORE=file` and a temporary `SMSTUNNEL_CONFIG_DIR`. `SMSTUNNEL_KEYCHAIN_SERVICE` changes the keychain item name, for a manual check of the keychain code with a dummy key; `SMSTUNNEL_POLL_INTERVAL_MS` makes `--wait` and `--watch` poll faster in tests.

The exact behaviour, for ports to other languages, is in [CLI-SPEC.md](CLI-SPEC.md). Releases: [PUBLISHING.md](PUBLISHING.md).

## License

MIT, © NARBOWEB SRL. See [LICENSE](LICENSE).
