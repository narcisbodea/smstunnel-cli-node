# Changelog

All notable changes to `smstunnel` are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-11-03

### Added

- `smstunnel login` / `logout`: the API key is read hidden from the terminal (or the first line of standard input), checked
  with SMSTunnel before it is saved, and kept in the macOS Keychain, Windows Credential Manager or the Linux Secret Service,
  else in a `config.json` only you can read (0600). `SMSTUNNEL_API_KEY` overrides it.
- `smstunnel send <number> <message…>`: one text to one number, from your own phone. `--phone`, `--country`, `--wait`
  (`--timeout`), the text from standard input, and `--idempotency-key` (sent as `Idempotency-Key`: the same command again
  within 24 hours gets the first answer back instead of a second text).
- `smstunnel code <number> <message…>`: sign-in codes through `/sms/send-2fa`, with the same check for the code as SMSTunnel.
- `smstunnel status`, `smstunnel phones`, `smstunnel usage`, and `smstunnel received` (`--since`, `--from`, `--phone`,
  `--limit`, `--watch`).
- `--json` on every command (errors as JSON on standard error), `--api-base` / `SMSTUNNEL_API_BASE`, and documented exit codes.
- No runtime dependencies (Node.js 18 or newer). The CLI never resends a text by itself.
