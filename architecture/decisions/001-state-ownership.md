# ADR-001: Separate domain, UI and persistent state

Status: implemented.

A desktop exposes several related lifetimes: a process may crash while its window
remains visible, a draft may differ from the committed file, and a selection may
be local to one Files instance. Combining these in one store would obscure ownership
and make unrelated windows subscribe to each other's changes.

Use plain TypeScript services for domain transitions. The Window Manager has a
small Zustand store; runtime maps own processes and close guards. Observable app
sessions own document/directory state. React state and cohesive custom hooks own
interaction and browser-resource cleanup. Repositories own persistence.

This requires explicit capability wiring in the composition root but avoids UI
database access, duplicated file state and a universal dependency container. A hook
adapts a service; it does not move filesystem rules into React.

Evidence: [runtime](../../src/core/runtime/service.ts),
[windows](../../src/core/windows/service.ts),
[document session](../../src/apps/text-document/session.ts).
