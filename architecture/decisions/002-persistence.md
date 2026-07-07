# ADR-002: Confirm saves after atomic commit and reject stale revisions

Status: implemented with schema v1.

IndexedDB request success can precede transaction abort. Concurrent windows may
also edit the same loaded revision. Neither situation permits a truthful successful
save or an unconditional overwrite.

Repository adapters complete transactions before returning successful receipts or
publishing changes. Text, metadata/revisions and aggregate counters change together.
Writes require the expected content revision; a stale save returns a conflict and
leaves committed text untouched. Document sessions keep local drafts on failure and
retain newer edits made during an in-flight save.

Memory repositories implement the same contracts for temporary mode and tests.
There is no direct IndexedDB access from UI components. Quota/abort/corruption remain
classified failures, not automatic reset triggers. Schema changes will require real
previous-version fixtures; schema v1 does not include a speculative migration system.

Evidence: [storage adapters](../../src/core/storage),
[repository contract tests](../../src/core/filesystem/repository.contract.test.ts),
[native write tests](../../e2e/persistence/write-repository.spec.ts).
