# smstunnel

Send texts from your computer through your own Android phone and number.

`smstunnel` is the command-line tool for [SMSTunnel](https://smstunnel.io): you write a text in your terminal or a script, SMSTunnel hands it to your linked Android phone, and your phone sends it from your own number, on your own SIM and plan. It also checks whether a text went out, sends sign-in codes, lists the texts your phone received and shows what is left of your plan today.

- Zero dependencies: Node.js 18 or newer is all it needs.
- Your API key stays in your system keychain (macOS Keychain, Windows Credential Manager, the Linux Secret Service), or in a file only you can read.
- One number per text. Each text goes to one person: there are no lists of numbers or CSV imports.

The phone needs the SMSTunnel app from Google Play, signed in to your account:

<a href="https://play.google.com/store/apps/details?id=io.smstunnel.app"><img src="https://smstunnel.io/google-play-badge.png" alt="Get it on Google Play" height="56"></a>

## Install

```bash
npm install -g smstunnel
```

Or run it once without installing: `npx smstunnel phones`.

With Homebrew (macOS and Linux), once the tap is published:

```bash
brew install narcisbodea/tap/smstunnel
```

## Sign in

1. In your dashboard, [dashboard.smstunnel.io](https://dashboard.smstunnel.io), open **Apps → Add an app** and create the key. It is shown only once.
2. Run:

```bash
smstunnel login
```

Paste the key when asked (it stays hidden) and press Enter. The CLI checks it with SMSTunnel first and saves it only if it works:

| System | Where the key is saved |
|---|---|
| macOS | your Keychain (`security`), item "smstunnel" |
| Windows | Windows Credential Manager (through Windows PowerShell), item "smstunnel" |
| Linux | your keyring through the Secret Service (`secret-tool`), when it is installed and a desktop session is running |
| anything else | `~/.config/smstunnel/config.json` (`%APPDATA%\smstunnel` on Windows), readable only by you (mode 0600). The CLI says so with a warning. |

The key never goes on the command line. To pipe it in from a password manager: `pass show smstunnel | smstunnel login`.

`SMSTUNNEL_API_KEY`, when set, is used instead of the saved key (handy in CI). `smstunnel logout` removes the saved key from this computer; the key itself keeps working until you deactivate or delete it in your dashboard.

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

This lists the texts your phone received after you turned on "Sync received texts" in the SMSTunnel app (it is off by default; the phone's existing inbox is never read). The key must be allowed to read received messages: in your dashboard, open API keys and allow it for that key. Options: `--since` (a date such as `2026-11-03`, or `30m`, `2h`, `1d`), `--from <number>`, `--phone <id or name>`, `--limit` (up to 100), and `--watch` to keep printing new texts as they arrive (every `--interval` seconds, 10 by default; Ctrl+C stops).

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

Send only texts people expect from you: alerts to yourself, reminders, sign-in codes, replies they asked for.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Done. A text "not confirmed by your phone" also ends with 0: it was most likely sent, never send it again |
| 1 | Something unexpected |
| 2 | Invalid arguments, or SMSTunnel refused the input (HTTP 400) |
| 3 | No API key, or SMSTunnel refused it (HTTP 401) |
| 4 | The key or your plan doesn't allow it (HTTP 403), for example a key that may not read received texts |
| 5 | Not found (HTTP 404): an unknown message id or phone |
| 6 | Too many requests (HTTP 429 with `Retry-After`: the CLI says how many seconds to wait), or today's allowance is used up (429 without it) |
| 7 | SMSTunnel could not be reached or had a problem (5xx). If a send broke after it left, the CLI says the text may have gone out: check before sending it again |
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

Up to 30 send requests a minute and 100 other requests a minute. How many texts and sign-in codes you can send a day depends on your plan: see [Pricing](https://smstunnel.io/pricing/) and `smstunnel usage`.

## Privacy

The CLI talks only to `https://smstunnel.io` (or the `--api-base` you give it), over HTTPS, with your key in the `X-API-Key` header. It sends no analytics. See the [privacy policy](https://smstunnel.io/privacy/).

## Homebrew tap

`Formula/smstunnel.rb` is ready for a tap at `github.com/narcisbodea/homebrew-tap`:

1. Publish the package to npm (`npm publish`).
2. Put the tarball's SHA-256 in the formula:
   ```bash
   curl -sL https://registry.npmjs.org/smstunnel/-/smstunnel-1.0.0.tgz | shasum -a 256
   ```
3. Create the public repository `narcisbodea/homebrew-tap` and add the formula as `Formula/smstunnel.rb`.
4. Check it: `brew install --build-from-source narcisbodea/tap/smstunnel && brew test smstunnel && brew audit --strict --online smstunnel`.

People then install it with `brew install narcisbodea/tap/smstunnel`. For each new version, update `url` and `sha256`.

## Why there is no winget package

winget installs Windows programs from installers (MSI, MSIX, EXE) or self-contained zip files. `smstunnel` is a JavaScript program that runs on Node.js, and a winget package can't simply say "run this with the Node.js you have". It would need a single executable with Node.js bundled in (about 80 MB per version, rebuilt and code-signed for every release), for a tool that is a few kilobytes on npm. On Windows, install it with `npm install -g smstunnel` (Node.js itself is on winget: `winget install OpenJS.NodeJS.LTS`).

## Development

```bash
npm install
npm test              # build, then the unit tests (node --test)
npm run test:e2e      # the built CLI against a local mock of the API
npm run test:dev-api  # the built CLI against a local SMSTunnel API (see below)
```

`test:dev-api` runs only when these are set, and only against a local API (never smstunnel.io): `SMSTUNNEL_E2E_API_BASE` (for example `http://127.0.0.1:3121/api/v1`), `SMSTUNNEL_E2E_KEY` (a throwaway key with `sms:send`, `sms:read` and `sms:inbox`), and optionally `SMSTUNNEL_E2E_SEND_ONLY_KEY`, `SMSTUNNEL_E2E_ONLINE_PHONE`, `SMSTUNNEL_E2E_OFFLINE_PHONE`, `SMSTUNNEL_E2E_NUMBER` and `SMSTUNNEL_E2E_EXPECT_RECEIVED`. It sends 3 texts. The tests never touch your real keychain: they use `SMSTUNNEL_KEY_STORE=file` and a temporary `SMSTUNNEL_CONFIG_DIR`. `SMSTUNNEL_KEYCHAIN_SERVICE` changes the keychain item name, for a manual check of the keychain code with a dummy key; `SMSTUNNEL_POLL_INTERVAL_MS` makes `--wait` and `--watch` poll faster in tests.

## License

MIT
