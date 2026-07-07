# ADR-003: Lazy CodeMirror with a canonical document session

Status: implemented. CodeMirror 6 is the shipped editor engine.

The portfolio needs syntax highlighting, search and editor history without a
language-server platform or an eager desktop-wide payload. The document model must
also preserve shared Save/Save As/conflict/dirty-close rules.

Load CodeMirror only when its rich editor is needed. The shared text-document
session remains canonical; a per-window engine owner caches UI state for up to 20
tabs and mounts one active view. Theme/rename/save preserve history; external text
replacement clears stale undo. Closing a tab/window releases its state/view.

LF/CRLF/CR round-trip through storage. Mixed endings are read-only until explicit
conversion. Native input handles loading/failure and transfers the latest draft and
selection; composition delays attachment. Late loads cannot recreate closed views.

The engine remains a substantial lazy chunk (~432 kB raw / 146 kB gzip in the measured
build). There are no editor workers, language servers or arbitrary code execution.
This choice trades advanced IDE features for a bounded editor and simpler lifetimes.

Evidence: [engine owner](../../src/apps/editor/engine/owner.ts),
[pool tests](../../src/apps/editor/engine/pool.test.tsx),
[browser engine tests](../../e2e/editor-engine.spec.ts).
