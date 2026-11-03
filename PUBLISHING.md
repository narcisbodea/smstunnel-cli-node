# Publishing `smstunnel`

Three places: the GitHub repository `narcisbodea/smstunnel-cli`, the npm package `smstunnel` (the name was still free on
npm on 3 November 2026), and the Homebrew tap `narcisbodea/homebrew-tap`. The accounts are the ones that already exist:
npm `narcisbodea` (two-factor sign-in with Windows Hello) and GitHub `narcisbodea`. Homebrew needs no account, only the
public tap repository.

npm can attach a trusted publisher (GitHub Actions, no stored token) only to a package that already exists, so version
1.0.0 is published by hand and every later version from the release workflow.

## Before the first release

From this folder:

```bash
npm ci
npm run typecheck
npm test               # unit tests
npm run test:e2e       # the built CLI against a mock of the API
npm pack --dry-run     # 24 files: dist/, README.md, LICENSE, CHANGELOG.md, package.json
```

## 1. GitHub repository

1. On GitHub, create the **public** repository `narcisbodea/smstunnel-cli`, without a README, licence or .gitignore (this
   folder has them). The `repository`, `homepage` and `bugs` fields of `package.json` point there; npm checks
   `repository` when it records where a version was built.
2. Push this folder:

   ```bash
   git remote add origin https://github.com/narcisbodea/smstunnel-cli.git
   git push -u origin main
   ```

3. The **CI** workflow (`.github/workflows/ci.yml`) runs the tests on Linux, Windows and macOS with Node.js 22, 24 and 26.
   Wait for it to pass.

## 2. First npm version, by hand (1.0.0)

From a normal terminal in this folder, signed in to npm as `narcisbodea` (`npm whoami`; `npm login` if needed):

```bash
npm publish
```

`prepack` builds `dist/` and `prepublishOnly` runs the type check, the unit tests and the mock end-to-end tests first;
`publishConfig.access` is already `public`. npm asks for the security-key confirmation in the browser (Windows Hello).
The version shows up on <https://www.npmjs.com/package/smstunnel> within a few minutes (`npm view smstunnel version`).

Don't push a `v1.0.0` tag yet: a tag starts the release workflow (section 3 sets up what it needs first).

## 3. Trusted publishing for later versions

1. **npmjs.com → smstunnel → Settings → Trusted Publisher → GitHub Actions**:
   - Organization or user: `narcisbodea`
   - Repository: `smstunnel-cli`
   - Workflow filename: `release.yml`
   - Environment name: `npm`

   Save it. npm expects a first publish through a new trusted publisher within 2 days of creating it; if the next release
   is further away, set it up just before that release (or delete and recreate it).
2. **GitHub → smstunnel-cli → Settings → Environments → New environment** named `npm`:
   - **Required reviewers**: `narcisbodea`, so every publish waits for your approval;
   - **Deployment branches and tags**: "Selected branches and tags", add the tag rule `v*`.
3. **npmjs.com → smstunnel → Settings → Publishing access**: choose **Require two-factor authentication and disallow
   tokens**, then **Update Package Settings**. Trusted publishing keeps working (it doesn't use a token); nothing else can
   publish without your second factor.
4. Tag 1.0.0, so the repository shows the published version:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   The **Release** run for this tag waits for your approval in the `npm` environment: **reject** it, since 1.0.0 is
   already on npm (approving it would only fail at `npm publish`).

## 4. Every later version

1. Raise `version` in `package.json` (for example `npm version patch --no-git-tag-version`), and add the entry at the top of
   `CHANGELOG.md`.
2. Commit, then tag and push:

   ```bash
   git commit -am "smstunnel 1.0.1"
   git tag v1.0.1
   git push origin main v1.0.1
   ```

3. **Actions → Release**: approve the `npm` deployment. The workflow checks that the tag matches `package.json`, runs the
   tests, and publishes with `npm publish --access public` (npm adds the provenance statement by itself).
4. Update the Homebrew formula (section 5, "New versions").

## 5. Homebrew tap

`Formula/smstunnel.rb` installs the npm tarball with Homebrew's own Node.js (`depends_on "node"`,
`npm install *std_npm_args`) and links the `smstunnel` command.

### First version

1. After the npm publish, get the tarball's SHA-256:

   ```bash
   curl -sL https://registry.npmjs.org/smstunnel/-/smstunnel-1.0.0.tgz | shasum -a 256
   ```

   On Windows: `curl.exe -sL https://registry.npmjs.org/smstunnel/-/smstunnel-1.0.0.tgz -o smstunnel.tgz` and then
   `(Get-FileHash smstunnel.tgz -Algorithm SHA256).Hash.ToLower()` in PowerShell.
2. On GitHub, create the **public** repository `narcisbodea/homebrew-tap` (the `homebrew-` prefix is what lets
   `brew tap narcisbodea/tap` find it).
3. Copy `Formula/smstunnel.rb` from this repository into it as `Formula/smstunnel.rb`, replace
   `REPLACE_WITH_THE_SHA256_OF_THE_PUBLISHED_TARBALL` with the checksum, commit and push.
4. Check it on a Mac (or on Linux with Homebrew):

   ```bash
   brew tap narcisbodea/tap
   brew install narcisbodea/tap/smstunnel
   brew test narcisbodea/tap/smstunnel
   brew audit --strict --online narcisbodea/tap/smstunnel
   ```

   The formula's test runs `smstunnel --version`, then `smstunnel phones` with no key, which must end with exit code 3 and
   print the words `smstunnel login` ("No API key yet. Run "smstunnel login" and paste a key from your dashboard …"). That
   is what 1.0.0 does; if a later version changes that message or exit code, change the test too.

People then install it with `brew install narcisbodea/tap/smstunnel`. It is available as soon as the tap is pushed; there
is no review.

### New versions

In the tap, change `url` to the new tarball (`…/smstunnel/-/smstunnel-1.0.1.tgz`) and `sha256` to its checksum (step 1
above), run `brew audit --strict --online narcisbodea/tap/smstunnel` and `brew upgrade smstunnel`, commit
("smstunnel 1.0.1") and push. Keep the copy in this repository's `Formula/` the same.

The official Homebrew repository (homebrew-core) takes only well-known projects; it is not part of this plan. Read its
contribution rules, including any on AI-written code, before ever submitting there.
