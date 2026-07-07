# Development and validation

Use Node.js **24.18.0** (see `.nvmrc`) and the committed npm lockfile.
If you use nvm:

```bash
nvm install
nvm use
npm ci
npm run dev
```

`npm run check` runs ESLint, strict TypeScript, all Vitest tests and the production
build. Tests run once with `npm run test:run`; `npm run test` starts watch mode.

## Browser tests

Install matching Playwright browsers:

```bash
npx playwright install chromium firefox webkit
# On Linux, also install the required system libraries:
# npx playwright install --with-deps chromium firefox webkit
```

Run these commands sequentially:

```bash
npm run check
npm run test:e2e
npm run test:persistence
npm run test:cross-browser
```

The desktop suite uses Chromium; persistence tests use isolated native IndexedDB
fixtures; cross-browser smoke runs selected critical contracts in Firefox/WebKit.
Playwright manages the local servers. Do not run a build or another preview suite
at the same time: desktop tests share `dist` and port 4173. Persistence uses 4174.
The tests use isolated browser contexts, not your normal browser's saved workspace.

To reproduce CI reporters, worker limits and flaky-test handling locally, prefix
each browser command with `CI=true` (or set that environment variable in your shell).

## GitHub Actions

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`. The quality
job gates three independent browser jobs. Jobs use Ubuntu 24.04, the Node version
in `.nvmrc`, `npm ci`, npm download caching and matching Playwright browser/system
library installation. Action references are pinned to verified commit SHAs.

Browser artifacts include `playwright-report/` and `test-results/`, with seven-day
retention. Download a failed job's artifact to inspect its HTML report and retained
trace. No deployment, commits or repository writes are performed by this workflow.
A passing local run does not establish a passing hosted Ubuntu run; check the Actions
results after pushing. Required branch checks must be configured in GitHub separately.

## Diagnostic performance run

```bash
npm run test:performance
```

This one-worker Chromium workload records timings, GC heap/DOM counts, trace and
bundle sizes under `test-results/performance/`. It is excluded from routine E2E.
Timings include automation overhead and depend on hardware; no timing thresholds
are used as release gates.

For a hosted run, open **Actions → BrowserOS CI → Run workflow** and enable
**performance**. The workflow still runs the quality/browser gates and adds the
diagnostic job; its measurements and trace are uploaded as a separate artifact.
