import type { VfsChange, VfsChangeListener, VfsChangeScope } from './types'

/** Invalidations only; repository data remains the source of truth. */
export function createVfsChangeDispatcher(
  onListenerError: (error: unknown) => void = (error) =>
    console.error('VFS change listener failed.', error),
) {
  const listeners = new Map<
    object,
    { scope: VfsChangeScope; listener: VfsChangeListener }
  >()
  const queue: VfsChange[] = []
  let dispatching = false
  function report(error: unknown) {
    try {
      onListenerError(error)
    } catch {
      /* Diagnostics cannot undo a commit. */
    }
  }
  function matches(scope: VfsChangeScope, event: VfsChange) {
    if (scope.kind === 'all') return true
    if (scope.kind === 'directory' && event.directoryIds.includes(scope.id))
      return true
    return (
      event.metadataIds.includes(scope.id) ||
      event.contentIds.includes(scope.id) ||
      event.pathIds.includes(scope.id) ||
      event.removedIds.includes(scope.id)
    )
  }
  return {
    subscribe(scope: VfsChangeScope, listener: VfsChangeListener) {
      const token = {}
      listeners.set(token, { scope: Object.freeze({ ...scope }), listener })
      return () => {
        listeners.delete(token)
      }
    },
    emit(event: VfsChange) {
      queue.push(event)
      if (dispatching) return
      dispatching = true
      try {
        for (let index = 0; index < queue.length; index++) {
          const current = queue[index]
          for (const [token, subscription] of [...listeners]) {
            if (!listeners.has(token) || !matches(subscription.scope, current))
              continue
            try {
              const result = subscription.listener(current)
              if (result) void result.catch(report)
            } catch (error) {
              report(error)
            }
          }
        }
      } finally {
        queue.length = 0
        dispatching = false
      }
    },
  }
}
