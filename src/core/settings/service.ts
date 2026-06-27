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
    warning: null,
    error: null,
  })
  let disposed = false
  let busy = false
  const listeners = new Set<() => void>()
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
    load: async (): Promise<SettingsResult<void>> => {
      if (disposed)
        return settingsFailure('DISPOSED', 'Settings have been closed.')
      if (busy) return settingsFailure('BUSY', 'Settings are being updated.')
      busy = true
      try {
        const result = await repository.readTheme()
        if (disposed)
          return settingsFailure('DISPOSED', 'Settings have been closed.')
        if (!result.ok && result.error.code !== 'CORRUPT_DATA') return result
        publish({
          theme: result.ok ? result.value : 'system',
          saving: false,
          warning: result.ok ? null : result.error.message,
          error: null,
        })
        return { ok: true, value: undefined }
      } catch {
        return settingsFailure(
          'STORAGE_UNAVAILABLE',
          'Settings could not be loaded.',
        )
      } finally {
        busy = false
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
            ? { theme, saving: false, warning: null, error: null }
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
        busy = false
      }
    },
    dispose: () => {
      disposed = true
      listeners.clear()
    },
  }
}
export type SettingsService = ReturnType<typeof createSettingsService>
