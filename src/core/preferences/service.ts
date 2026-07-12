import type { AppId } from '../shared/ids'

export interface ShellPreferences {
  readonly pinned: readonly AppId[] | null
  readonly wallpaper: 'warm' | 'cool'
  readonly shortcutOrder: 'default' | 'name'
  readonly reduceMotion: boolean
}
export const defaultPreferences: ShellPreferences = Object.freeze({
  pinned: null,
  wallpaper: 'warm',
  shortcutOrder: 'default',
  reduceMotion: false,
})
export interface PreferenceRepository {
  read(): Promise<ShellPreferences>
  write(value: ShellPreferences): Promise<void>
}
export function decodePreferences(value: unknown): ShellPreferences {
  if (value === undefined) return defaultPreferences
  if (
    !value ||
    typeof value !== 'object' ||
    !('pinned' in value) ||
    !('wallpaper' in value) ||
    !('shortcutOrder' in value) ||
    !('reduceMotion' in value) ||
    (value.pinned !== null &&
      (!Array.isArray(value.pinned) ||
        value.pinned.length > 100 ||
        value.pinned.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(value.pinned).size !== value.pinned.length)) ||
    (value.wallpaper !== 'warm' && value.wallpaper !== 'cool') ||
    (value.shortcutOrder !== 'default' && value.shortcutOrder !== 'name') ||
    typeof value.reduceMotion !== 'boolean'
  )
    throw new Error(
      'Saved desktop preferences are invalid. Your current layout has been kept.',
    )
  return Object.freeze({
    pinned:
      value.pinned === null
        ? null
        : (Object.freeze([...value.pinned]) as readonly AppId[]),
    wallpaper: value.wallpaper as ShellPreferences['wallpaper'],
    shortcutOrder: value.shortcutOrder as ShellPreferences['shortcutOrder'],
    reduceMotion: value.reduceMotion,
  })
}
export function createMemoryPreferenceRepository(): PreferenceRepository {
  let value = defaultPreferences
  return {
    read: async () => value,
    write: async (next) => {
      value = decodePreferences(next)
    },
  }
}
export function createPreferenceService(repository: PreferenceRepository) {
  let snapshot = {
    value: defaultPreferences,
    busy: false,
    loaded: false,
    error: null as string | null,
  }
  let disposed = false
  const listeners = new Set<() => void>()
  const publish = (next: typeof snapshot) => {
    if (!disposed) {
      snapshot = next
      for (const listener of listeners) listener()
    }
  }
  async function perform(operation: () => Promise<ShellPreferences>) {
    if (disposed || snapshot.busy) return false
    publish({ ...snapshot, busy: true, error: null })
    try {
      const value = decodePreferences(await operation())
      if (disposed) return false
      publish({ value, busy: false, loaded: true, error: null })
      return true
    } catch (error) {
      publish({
        ...snapshot,
        busy: false,
        loaded: true,
        error:
          error instanceof Error
            ? error.message
            : 'Desktop preferences could not be saved.',
      })
      return false
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load: () => perform(repository.read),
    update: (patch: Partial<ShellPreferences>) =>
      perform(async () => {
        const next = decodePreferences({ ...snapshot.value, ...patch })
        await repository.write(next)
        return next
      }),
    dispose: () => {
      disposed = true
      listeners.clear()
    },
  }
}
