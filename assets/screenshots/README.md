# Genuine BrowserOS screenshots

Captured on 6 October 2026 from the local production build with Playwright Chromium,
1440×1080 viewport, device scale1 and reduced motion. They reflect the working tree
with the new getting-started copy, not a hosted deployment or generated mockup.

| Image               | Contents                                                      |
| ------------------- | ------------------------------------------------------------- |
| desktop-light.png   | Empty desktop, light appearance                               |
| desktop-dark.png    | Empty desktop, dark appearance                                |
| about-light.png     | Getting-started guidance                                      |
| workspace-light.png | Files + saved TypeScript Editor + Terminal reading saved text |
| workspace-dark.png  | Same workspace, dark appearance                               |
| export-dark.png     | Prepared saved-data JSON download in Settings                 |

Regenerate using `npm run demo:screenshots`. The script builds first, owns preview
port4176 and captures a fresh browser context. It reads tracked examples, saves
through Notes/Editor, reloads, reads through Terminal and validates the actual
JSON download. No raw seed, production globals or user browser storage are used.
Window placement uses normal pointer/menu controls. No CSS/DOM edits are made for
images. The clock is real capture time; images are not pixel-identical across runs.

The script exits on a failed verification and closes its browser/server. If a run
fails, do not publish partially refreshed images; rerun and inspect all six outputs.
Screenshots document current desktop UI, not manual accessibility certification.
