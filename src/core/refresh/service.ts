import type { SettingsService } from '../settings/service'
export interface RefreshSnapshot {
  readonly refreshing: boolean
  readonly revision: number
  readonly error: string | null
}
export function createRefreshService(dependencies: {
  settings: SettingsService
  validate: () => Promise<{ readonly ok: boolean }>
  onListenerError?: (error: unknown) => void
}) {
  let snapshot: RefreshSnapshot = Object.freeze({
    refreshing: false,
    revision: 0,
    error: null,
  })
  const lifetime = new AbortController()
  let disposed = false
  let requested = false
  let active: Promise<void> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: RefreshSnapshot) => {
    if (disposed) return
    snapshot = Object.freeze(next)
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        try {
          dependencies.onListenerError?.(error)
        } catch {
          /* Observers do not own refresh. */
        }
      }
    }
  }
  async function run() {
    // Start after the promise owner has been assigned, including reentrant observers.
    await Promise.resolve()
    while (requested && !disposed) {
      requested = false
      publish({ ...snapshot, refreshing: true, error: null })
      try {
        await dependencies.settings.whenIdle(lifetime.signal)
        if (disposed) break
        const valid = await dependencies.validate()
        if (disposed) break
        if (!valid.ok) throw new Error('Invalid workspace')
        let loaded
        do {
          await dependencies.settings.whenIdle(lifetime.signal)
          if (disposed) break
          loaded = await dependencies.settings.load()
        } while (!loaded?.ok && loaded?.error.code === 'BUSY')
        if (disposed) break
        if (!loaded?.ok) throw new Error('Settings unavailable')
        publish({
          refreshing: true,
          revision: snapshot.revision + 1,
          error: null,
        })
      } catch {
        publish({
          ...snapshot,
          refreshing: true,
          error:
            'Workspace could not be updated. Your current view has been kept. Please retry.',
        })
      }
    }
    active = undefined
    publish({ ...snapshot, refreshing: false })
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (!disposed) listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    request: () => {
      if (disposed) return Promise.resolve()
      requested = true
      active ??= run()
      return active
    },
    dispose: () => {
      disposed = true
      lifetime.abort()
      requested = false
      listeners.clear()
    },
  }
}
export type RefreshService = ReturnType<typeof createRefreshService>
