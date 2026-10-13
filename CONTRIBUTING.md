# Contributing

Bug reports and pull requests are welcome. For layout bugs, include the Chrome
version, whether GitHub uses Split or Unified view, and whether the file is new
or modified. A public example PR helps; do not include private code or account
information in screenshots.

## Development

Use Node.js 22 or later:

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run package
```

On Linux, use `npx playwright install --with-deps chromium` to install browser
dependencies too. Load `extension/` unpacked from `chrome://extensions` and click
the extension's Reload button after editing it. Reload the PR to apply changes.

Tests load the actual unpacked extension in a temporary Chromium profile and
serve local GitHub-style fixtures. They do not require a GitHub account.
The optional live checks depend on public GitHub pages and are separate from CI:

```sh
# macOS / Linux
LIVE_PR=1 npm test
```

```powershell
# PowerShell
$env:LIVE_PR = '1'
npm test
```

Keep changes focused. Preserve modified-file split diffs, line anchors,
highlighting, and review controls. Include a meaningful regression check when
changing diff detection or layout behavior. Keep `package.json` and the extension
manifest versions in sync when preparing a release.

## Releases

Run all checks and `npm run package`, tag the tested commit as `vX.Y.Z`, and
attach `dist/full-width-new-pr-files-vX.Y.Z.zip` to a GitHub release. The ZIP
includes the extension, README, and license. GitHub Actions also uploads a
verified ZIP for each successful run.

By contributing, you agree that your contributions are licensed under the
project's MIT license.
