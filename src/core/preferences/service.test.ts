import { describe, expect, it, vi } from 'vitest'
import {
  createMemoryPreferenceRepository,
  createPreferenceService,
  decodePreferences,
  defaultPreferences,
  type ShellPreferences,
} from './service'
import { pinnedApps, reorderPinned } from './dock'
import { aboutManifest } from '../../apps/about/manifest'
import { filesManifest } from '../../apps/files/manifest'
import type { AppId } from '../shared/ids'

describe('desktop preferences', () => {
  it('validates preferences without accepting duplicate or unknown-shaped values', () => {
    expect(decodePreferences(undefined)).toBe(defaultPreferences)
    for (const invalid of [
      null,
      {},
      { ...defaultPreferences, pinned: ['a', 'a'] },
      { ...defaultPreferences, pinned: [1] },
      { ...defaultPreferences, wallpaper: 'bad' },
      { ...defaultPreferences, reduceMotion: 1 },
    ])
      expect(() => decodePreferences(invalid)).toThrow()
  })
  it('commits only after storage succeeds and keeps the last value on failure', async () => {
    const repository = createMemoryPreferenceRepository(),
      preferences = createPreferenceService(repository)
    await preferences.load()
    const write = vi
      .spyOn(repository, 'write')
      .mockRejectedValueOnce(new Error('Quota exceeded'))
    expect(await preferences.update({ wallpaper: 'cool' })).toBe(false)
    expect(preferences.getSnapshot()).toMatchObject({
      value: { wallpaper: 'warm' },
      error: 'Quota exceeded',
      busy: false,
    })
    expect(await preferences.update({ wallpaper: 'cool' })).toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
    const restored = createPreferenceService(repository)
    await restored.load()
    expect(restored.getSnapshot().value.wallpaper).toBe('cool')
  })
  it('rejects overlapping writes and ignores late results after disposal', async () => {
    let finish!: (value: ShellPreferences) => void
    const preferences = createPreferenceService({
      read: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      write: async () => {},
    })
    const loading = preferences.load()
    expect(await preferences.update({ wallpaper: 'cool' })).toBe(false)
    preferences.dispose()
    finish({ ...defaultPreferences, wallpaper: 'cool' })
    await loading
    expect(preferences.getSnapshot().value.wallpaper).toBe('warm')
  })
  it('preserves a saved empty Dock, filters unavailable apps and reorders deterministically', () => {
    const apps = [aboutManifest, filesManifest]
    expect(pinnedApps(apps, defaultPreferences)).toEqual(
      apps.map((app) => app.id),
    )
    expect(pinnedApps(apps, { ...defaultPreferences, pinned: [] })).toEqual([])
    expect(
      pinnedApps(apps, {
        ...defaultPreferences,
        pinned: ['missing' as AppId, filesManifest.id],
      }),
    ).toEqual([filesManifest.id])
    const ids = apps.map((app) => app.id)
    expect(reorderPinned(ids, ids[0], ids[1])).toEqual([ids[1], ids[0]])
    expect(reorderPinned(ids, 'missing' as AppId, ids[1])).toBe(ids)
  })
})
