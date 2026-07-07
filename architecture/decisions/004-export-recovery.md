# ADR-004: Export a committed snapshot; keep recovery non-destructive

Status: implemented export v1; import/reset deferred.

Reading folders, text and theme separately can mix commits. Export must also make
clear that an unsaved editor draft is not a saved file, and a failed read must not
produce a partial backup or silently repair the database.

Read `nodes`, `contents`, `meta` and `settings` in one readonly transaction, wait for
completion and validate the result. Temporary mode captures memory files/theme in
one JavaScript turn. Serialize afterwards into a `browser-os-workspace` v1 envelope
with generation time, source mode, committed theme and stable-ID entries including
root/empty folders and exact text. Internal content IDs/revisions and live UI state
are excluded.

Settings uses Prepare followed by a native Download JSON link. Its local hook guards
duplicate clicks/late results and releases Blob URLs on replacement/unmount. A ready
copy stays unchanged until prepared again. VFS budgets apply; the UTF-8 JSON cap is
64 MiB, checked after synchronous serialization.

Boot failures offer classified guidance, retry and explicit temporary mode. Import,
atomic restore/reset and binary data need separate validation and are not release
features. Export cannot recover a database that cannot be opened or validated.

Evidence: [snapshot reader](../../src/core/storage/exportReader.ts),
[export service](../../src/core/export/service.ts),
[download hook](../../src/apps/settings/useWorkspaceExport.ts).
