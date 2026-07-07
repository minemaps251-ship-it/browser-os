# Deploy BrowserOS to Vercel

BrowserOS builds to static assets. It needs no backend, environment secrets or
server-side database. The [production deployment](https://browser-os-flax.vercel.app/) is live.

## Configure the project

1. Push the reviewed changes and confirm that GitHub Actions passes for that commit.
2. In Vercel, import `minemaps251-ship-it/browser-os`. Set the root directory to the
   repository root and the production branch to `main`.
3. Select the Vite preset and Node.js **24.x**. Check the build log satisfies
   `package.json`'s `>=24.18.0 <25` requirement. Local development uses `.nvmrc`.
4. The committed `vercel.json` sets install to `npm ci`, build to `npm run build`
   and output to `dist`. No environment variables are required.
5. Inspect the initial deployment before sharing its stable production URL.

These settings follow Vercel's [Vite integration](https://vercel.com/docs/frameworks/frontend/vite),
[project configuration](https://vercel.com/docs/project-configuration/vercel-json)
and [Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions).
VFS paths and application windows are internal state; the app has no URL routes
that require a catch-all rewrite.

## Verify the deployed build

Use a separate browser profile with disposable sample data. Record the deployed
URL, commit SHA, browser and results.

- Open the HTTPS production URL. Check that the desktop, icons and fonts load,
  and that the console and network show no failed application assets.
- Open Files, create a folder and text file, edit and save through Notes. Open
  the same file in Code Editor, edit and save, then read it with Terminal `cat`.
  This also exercises the editor's lazy-loaded JavaScript asset.
- Change the theme and reload the **same URL**. Confirm the saved text and theme
  return. Check that storage is persistent rather than temporary mode.
- Prepare and download an export in Settings. Inspect its JSON for the saved
  sample text and theme. Export has no corresponding import/restore feature.
- Check keyboard launch, window focus, close and move/resize menu controls.
  Complete the manual accessibility checks below before declaring release ready.
- Repeat basic launch, save and reload in Firefox and Safari. Automated WebKit
  coverage alone does not establish support for the user's installed Safari.

IndexedDB is scoped to the browser profile and origin (scheme, host and port).
Preview deployments, production domains and localhost have separate data.
Choose a stable production origin before creating important files. Changing
origins does not migrate data, and clearing site data can remove saved files.
Download an export before discarding an origin; currently there is no import UI.

## Manual release checks

Automated accessibility tests are useful evidence but do not replace these checks.
Use disposable documents and record the browser/OS and any failures.

- At actual browser zoom **200%**, use every app and its dialogs. Check that
  controls remain reachable, focused elements stay visible and scrolling works.
- With macOS VoiceOver, traverse the desktop and windows by keyboard. Check
  control names, dialog focus/return, Files selection, editor tabs, validation
  errors and Terminal output announcements.
- Check composition with an OS IME and move/resize/scroll on actual touch hardware
  if claiming support for those interactions.

These manual checks remain pending. The local Chrome automation attempt could
not verify zoom because native screen capture failed; it is not a passing result.

## Release record

After verification, add the stable demo link to README and record the deployment
commit and results. Keep manual failures explicit. Git tags and public release
announcements are separate actions after the checks pass.

The code is distributed under the [MIT license](LICENSE). Preserve its copyright
and permission notice when redistributing it.

## Verified deployment — 6 October 2026

- Production origin: https://browser-os-flax.vercel.app
- Source: `main`, commit `36078490434ed50c5da1d66720321b90a3c05e12`.
- Vercel deployment: `DLfrgQRR9A1wBK8phQwduUbBHauT`, status Ready.
- [GitHub Actions](https://github.com/minemaps251-ship-it/browser-os/actions/runs/37501336075):
  quality, Chromium, native persistence and cross-browser jobs passed. Diagnostic
  performance was skipped because it runs separately on request.
- Deployed smoke passed in Playwright Chromium, Firefox and WebKit using isolated
  browser contexts and disposable sample data. Notes and Code Editor saved text;
  reload, Files and Terminal confirmed it; the theme persisted and downloaded
  JSON contained the expected text and theme. No page errors, failed network
  requests or HTTP error responses were observed during those scenarios.
- Existing demo capture workflow was adapted temporarily for the remote origin;
  repository screenshot assets and the user's browser data were not overwritten.

These are automated smoke results, not a manual Safari, VoiceOver, 200% zoom,
IME or touch certification. Those manual checks remain open.
