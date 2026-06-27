import {
  isThemePreference,
  settingsFailure,
  type SettingsRepository,
  type SettingsResult,
  type ThemePreference,
} from './types'
export interface SettingsSnapshot {
  readonly theme: ThemePreference
  readonly saving: boolean
  readonly loading: boolean
  readonly warning: string | null
  readonly error: string | null
}
/** Shared settings only. DOM and persistence details belong to their adapters. */
export function createSettingsService(
  repository: SettingsRepository,
  onListenerError?: (error: unknown) => void,
) {
  let snapshot: SettingsSnapshot = Object.freeze({
    theme: 'system',
    saving: false,
    loading: false,
    warning: null,
    error: null,
  })
  let disposed = false
  let busy = false
  const listeners = new Set<() => void>()
  const idleWaiters = new Set<() => void>()
  const finish = () => {
    busy = false
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
  }
  const publish = (next: SettingsSnapshot) => {
    if (disposed) return
    snapshot = Object.freeze(next)
    for (const listener of listeners) {
      try {
        listener()
      } catch (error) {
        try {
          onListenerError?.(error)
        } catch {
          /* Observers cannot undo a committed setting. */
        }
      }
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      if (!disposed) listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    whenIdle: (signal?: AbortSignal) => {
      if (!busy || disposed || signal?.aborted) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const complete = () => {
          idleWaiters.delete(complete)
          signal?.removeEventListener('abort', complete)
          resolve()
        }
        idleWaiters.add(complete)
        signal?.addEventListener('abort', complete, { once: true })
      })
    },
    load: async (): Promise<SettingsResult<void>> => {
      if (disposed)
        return settingsFailure('DISPOSED', 'Settings have been closed.')
      if (busy) return settingsFailure('BUSY', 'Settings are being updated.')
      busy = true
      publish({ ...snapshot, loading: true, error: null })
      try {
        const result = await repository.readTheme()
        if (disposed)
          return settingsFailure('DISPOSED', 'Settings have been closed.')
        if (!result.ok && result.error.code !== 'CORRUPT_DATA') {
          publish({ ...snapshot, loading: false })
          return result
        }
        publish({
          theme: result.ok ? result.value : 'system',
          saving: false,
          loading: false,
          warning: result.ok ? null : result.error.message,
          error: null,
        })
        return { ok: true, value: undefined }
      } catch {
        const result = settingsFailure(
          'STORAGE_UNAVAILABLE',
          'Settings could not be loaded.',
        )
        publish({ ...snapshot, loading: false })
        return result
      } finally {
        finish()
      }
    },
    setTheme: async (theme: ThemePreference): Promise<SettingsResult<void>> => {
      if (disposed)
        return settingsFailure('DISPOSED', 'Settings have been closed.')
      if (!isThemePreference(theme))
        return settingsFailure('INVALID_VALUE', 'Choose a supported theme.')
      if (busy) return settingsFailure('BUSY', 'Settings are being updated.')
      if (theme === snapshot.theme && !snapshot.warning)
        return { ok: true, value: undefined }
      busy = true
      publish({ ...snapshot, saving: true, error: null })
      try {
        const result = await repository.writeTheme(theme)
        if (disposed)
          return settingsFailure('DISPOSED', 'Settings have been closed.')
        publish(
          result.ok
            ? {
                theme,
                saving: false,
                loading: false,
                warning: null,
                error: null,
              }
            : { ...snapshot, saving: false, error: result.error.message },
        )
        return result
      } catch {
        const result = settingsFailure(
          'STORAGE_UNAVAILABLE',
          'The appearance setting could not be saved. Please retry.',
        )
        publish({ ...snapshot, saving: false, error: result.error.message })
        return result
      } finally {
        finish()
      }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
      finish()
    },
  }
}
export type SettingsService = ReturnType<typeof createSettingsService>
