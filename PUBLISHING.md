# Publishing `smstunnel`

Two places: the GitHub repository `narcisbodea/smstunnel-cli-node` and the npm package `smstunnel` (the name was still free
on npm on 3 November 2026). Homebrew, winget, Scoop, apt, dnf and AUR carry the native Go version
(`narcisbodea/smstunnel-cli`), not this one, so there is only one Homebrew package. The accounts are the ones that already exist:
npm `narcisbodea` (two-factor sign-in with Windows Hello) and GitHub `narcisbodea`.

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

1. On GitHub, create the **public** repository `narcisbodea/smstunnel-cli-node`, without a README, licence or .gitignore (this
   folder has them). The `repository`, `homepage` and `bugs` fields of `package.json` point there; npm checks
   `repository` when it records where a version was built.
2. Push this folder:

   ```bash
   git remote add origin https://github.com/narcisbodea/smstunnel-cli-node.git
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
   - Repository: `smstunnel-cli-node`
   - Workflow filename: `release.yml`
   - Environment name: `npm`

   Save it. npm expects a first publish through a new trusted publisher within 2 days of creating it; if the next release
   is further away, set it up just before that release (or delete and recreate it).
2. **GitHub → smstunnel-cli-node → Settings → Environments → New environment** named `npm`:
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

