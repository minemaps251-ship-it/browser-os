# BrowserOS architecture

The composition root is [src/app](../src/app). It constructs the workspace and
runtime once outside React rendering. Apps consume runtime capabilities rather
than opening databases or managing other applications' stores.

## Ownership and boundaries

| Subsystem            | Owns                                                                          | Entry point                                         |
| -------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------- |
| Boot                 | Startup attempts, generation guards, recovery and workspace lifetime          | [boot.ts](../src/app/boot.ts)                       |
| Application Registry | Validated manifests, MIME handlers and instance policies                      | [registry.ts](../src/core/applications/registry.ts) |
| Runtime / processes  | Launch state, lazy loads, process scopes, file delivery and guarded close     | [service.ts](../src/core/runtime/service.ts)        |
| Window Manager       | Window identities, bounds, order, focus and visible/minimized/maximized state | [service.ts](../src/core/windows/service.ts)        |
| VFS                  | Names/paths, stable node identities, text operations and revision contracts   | [service.ts](../src/core/filesystem/service.ts)     |
| Storage              | IndexedDB schema, validation and atomic repository operations                 | [storage](../src/core/storage)                      |
| Settings / refresh   | Committed theme projection and explicit refresh coordination                  | [workspace.ts](../src/app/workspace.ts)             |
| Document sessions    | Loaded revision, dirty text, saving/conflict/deletion state                   | [session.ts](../src/apps/text-document/session.ts)  |
| Editor engine        | Per-tab UI state and the currently mounted CodeMirror view                    | [engine](../src/apps/editor/engine)                 |
| Export               | Validated snapshot → versioned JSON artifact                                  | [service.ts](../src/core/export/service.ts)         |

The Window Manager uses a narrow vanilla Zustand store. Process lifecycle remains
in runtime maps; document and directory sessions expose subscriptions. React local
state handles selection, dialogs and transient UI. IndexedDB owns committed files
and settings. There is no global store combining every subsystem.

CSS Modules sit beside components; [tokens.css](../src/styles/tokens.css) provides
shared semantic theme values. Hooks adapt sessions and browser lifetimes, while
filesystem rules and transaction logic stay independent of React.

## Launch and close

[Built-in registrations](../src/app/builtInApps.ts) pair manifests with lazy app
loaders. A launch creates a process scope, awaits the renderer and then opens its
window. IDs link the two concepts without treating them as the same object.
Cancellation prevents a late loader from restoring a disposed application.

A process can register a dirty-close guard. Concurrent close requests share a
pending decision; invalidated handlers and late approvals cannot close a different
window or invoke stale UI. Crash releases resources and leaves closeable chrome;
relaunch creates a fresh process. Scope cleanup isolates failures so one broken
resource does not block the others.

## Files → document → save

Files resolves a handler through registry metadata and the file-opening service.
Notes and Editor share document-session rules. A loaded file carries its content
revision; Save sends the draft and expected revision to the VFS. The repository
updates text, byte counts and revisions atomically. Only transaction completion
permits successful-save feedback and committed change events.

A concurrent write yields a conflict without overwriting the newer file. The local
draft remains available; the UI offers explicit reload or Save As. New edits made
while a save is pending are kept dirty after that save completes.

## Persistence and recovery

[Workspace composition](../src/app/workspace.ts) selects IndexedDB adapters or
memory repositories behind the same VFS service. Boot validates stored state before
exposing applications. Unsupported/corrupt storage produces recovery guidance;
it does not trigger automatic deletion. Retry and temporary mode are explicit.

Refresh lets apps re-read metadata/settings, including another tab's changes. It is
not a replicated store or continuous cross-tab synchronization protocol. Content
revision checks remain the protection against concurrent saves.

Schema v1 uses `nodes`, `contents`, `meta` and `settings`. Actual migration fixtures
must be added when the schema first changes; no invented v2 migration is present.

## Editor and export lifetimes

The editor session is canonical. CodeMirror contributes syntax, undo, selection and
scroll state. A lazy per-window owner caches tab states and keeps one active view;
closing tabs/windows releases resources. Native text input remains usable during
loading or failure, and composition delays attachment.

Export reads all four IndexedDB stores in one readonly transaction, validates the
snapshot and serializes after completion. Memory captures committed files/theme in
one JavaScript turn. Settings owns preparation/error/download state through a local
hook, revokes old Blob URLs and ignores late completion after unmount.

## Where to start reading

Follow [main.tsx](../src/main.tsx) → [boot.ts](../src/app/boot.ts) →
[workspace.ts](../src/app/workspace.ts) → [createRuntime.ts](../src/app/createRuntime.ts).
Then inspect the runtime/window services, the VFS repository contracts and the
shared document session. Tests beside those modules explain conflicts, cancellation
and cleanup; [e2e](../e2e) contains the user-facing integration paths.
