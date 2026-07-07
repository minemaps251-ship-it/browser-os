# BrowserOS demo: 3–5 minutes

Start with `npm ci` and `npm run dev`. Open the printed localhost URL and keep the
same hostname/port during the demo. Use a fresh browser profile for a clean workspace;
do not clear an existing workspace to prepare a recording.

## 1. Desktop and windows — 30 seconds

Open Files and Notes. Move a window, maximize/restore it and minimize/restore from
the Dock. The window menu also provides keyboard Move/Resize; use arrows, then Apply
or Escape. Choose Light/Dark from Appearance to show the shared theme.

## 2. One saved file across apps — 60 seconds

In Notes, paste [welcome.txt](examples/demo/welcome.txt). Choose Save, keep the home
directory and name the file `welcome.txt`. Open Terminal and enter these commands
one at a time:

```text
pwd
ls
cat welcome.txt
```

Show that Files sees the same saved document. Notes is the default text handler;
**Open in Code Editor** selects the alternative. Terminal is a small VFS command
interface, not a full shell.

## 3. Editor and safe closing — 60 seconds

Open Code Editor, paste [example.ts](examples/demo/example.ts), and Save As
`example.ts`. Show highlighting, Find, a second tab and undo/redo. Tab can leave the
editor; arrow keys switch the tab list. Save uses Ctrl/Cmd+S.

Make an unsaved change and close the window. Show Cancel, then Save and close.
Only committed text is shared with other applications; local drafts remain separate.
For a conflict demonstration, use two tabs on the same origin, save different edits
and show the explicit conflict/reload/Save As options. Do not claim live collaboration.

## 4. Persistence and export — 60 seconds

Reload, reopen Files and read `welcome.txt`. In Settings, select
**Prepare export → Download JSON**. Explain that the copy contains all saved text
files/folders and the committed theme, excluding unsaved drafts. Prepare again after
new saves; the existing download remains a fixed snapshot. Import is not available.

## Finish — 30 seconds

Point to the architecture/ADRs and automated checks in the repository. State the
current limits: text-only storage, no backend sync, browser-origin persistence,
manual accessibility checks and license/publication work still open.

## Genuine screenshot capture

```bash
npm run demo:screenshots
```

The script builds the current code, starts preview at `127.0.0.1:4176`, uses a fresh
Playwright Chromium context, saves both samples through the UI, verifies Terminal,
reload and downloaded JSON, and captures light/dark screenshots. It closes its
browser and server on completion/error. Install Chromium first with
`npx playwright install chromium`.

Do not run a build or preview test concurrently. Output is `assets/screenshots/`;
images show the real application, not generated mockups. Refresh them whenever UI
changes. This step supplies screenshots and a recording script, not a recorded
video or a hosted deployment.
