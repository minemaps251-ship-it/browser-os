import { describe, expect, it, vi } from 'vitest'
import { createRefreshService } from './service'
import { createSettingsService } from '../settings/service'
import { createMemorySettingsRepository } from '../settings/memoryRepository'
import { settingsFailure, type SettingsResult } from '../settings/types'

function fixture() {
  const repository = createMemorySettingsRepository()
  const read = vi.spyOn(repository, 'readTheme')
  const settings = createSettingsService(repository)
  const validate = vi.fn(async () => ({ ok: true }))
  const refresh = createRefreshService({ settings, validate })
  return { repository, read, settings, validate, refresh }
}
describe('workspace refresh', () => {
  it('re-reads committed settings and emits an immutable invalidation revision', async () => {
    const f = fixture()
    await f.repository.writeTheme('dark')
    const listener = vi.fn()
    f.refresh.subscribe(listener)
    await f.refresh.request()
    expect(f.settings.getSnapshot().theme).toBe('dark')
    expect(f.refresh.getSnapshot()).toEqual({
      refreshing: false,
      revision: 1,
      error: null,
    })
    expect(Object.isFrozen(f.refresh.getSnapshot())).toBe(true)
    expect(listener).toHaveBeenCalled()
    f.refresh.dispose()
    f.settings.dispose()
  })
  it('coalesces a burst into one active pass and one trailing pass', async () => {
    const f = fixture()
    let finish!: (result: { ok: boolean }) => void
    f.validate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const first = f.refresh.request()
    await vi.waitFor(() => expect(f.validate).toHaveBeenCalledOnce())
    const second = f.refresh.request()
    const third = f.refresh.request()
    expect(second).toBe(first)
    expect(third).toBe(first)
    finish({ ok: true })
    await first
    expect(f.validate).toHaveBeenCalledTimes(2)
    expect(f.read).toHaveBeenCalledTimes(2)
    expect(f.refresh.getSnapshot().revision).toBe(2)
    f.refresh.dispose()
    f.settings.dispose()
  })
  it('waits for a local save and never replaces it with an older read', async () => {
    const f = fixture()
    let finish!: () => void
    const write = f.repository.writeTheme
    vi.spyOn(f.repository, 'writeTheme').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            void write('dark').then(resolve)
          }
        }),
    )
    const save = f.settings.setTheme('dark')
    const updating = f.refresh.request()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.validate).not.toHaveBeenCalled()
    expect(f.read).not.toHaveBeenCalled()
    finish()
    await save
    await updating
    expect(f.settings.getSnapshot().theme).toBe('dark')
    expect(f.refresh.getSnapshot().error).toBeNull()
    f.refresh.dispose()
    f.settings.dispose()
  })
  it('does not announce success or reload settings after failed validation; retry succeeds', async () => {
    const f = fixture()
    f.validate.mockResolvedValueOnce({ ok: false })
    await f.refresh.request()
    expect(f.read).not.toHaveBeenCalled()
    expect(f.refresh.getSnapshot()).toMatchObject({
      revision: 0,
      refreshing: false,
      error: expect.any(String),
    })
    await f.refresh.request()
    expect(f.refresh.getSnapshot()).toMatchObject({ revision: 1, error: null })
    f.refresh.dispose()
    f.settings.dispose()
  })
  it('keeps the existing theme when a settings read fails', async () => {
    const f = fixture()
    await f.settings.setTheme('dark')
    f.read.mockResolvedValueOnce(
      settingsFailure('STORAGE_UNAVAILABLE', 'Denied'),
    )
    await f.refresh.request()
    expect(f.settings.getSnapshot()).toMatchObject({
      theme: 'dark',
      loading: false,
    })
    expect(f.refresh.getSnapshot()).toMatchObject({
      revision: 0,
      error: expect.any(String),
    })
    f.refresh.dispose()
    f.settings.dispose()
  })
  it('does not publish a late validation after dispose', async () => {
    const f = fixture()
    let finish!: (result: { ok: boolean }) => void
    f.validate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const updating = f.refresh.request()
    await vi.waitFor(() => expect(f.validate).toHaveBeenCalledOnce())
    const listener = vi.fn()
    f.refresh.subscribe(listener)
    f.refresh.dispose()
    finish({ ok: true })
    await updating
    expect(listener).not.toHaveBeenCalled()
    expect(f.read).not.toHaveBeenCalled()
    expect(f.refresh.getSnapshot().revision).toBe(0)
    await f.refresh.request()
    expect(f.validate).toHaveBeenCalledOnce()
    f.settings.dispose()
  })
  it('cancels waiting for an idle settings service when disposed', async () => {
    const f = fixture()
    let finish!: (result: SettingsResult<void>) => void
    vi.spyOn(f.repository, 'writeTheme').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const saving = f.settings.setTheme('dark')
    const updating = f.refresh.request()
    await Promise.resolve()
    await Promise.resolve()
    f.refresh.dispose()
    await updating
    expect(f.validate).not.toHaveBeenCalled()
    finish({ ok: true, value: undefined })
    await saving
    f.settings.dispose()
  })
  it('isolates observer errors and supports unsubscribe', async () => {
    const f = fixture()
    f.refresh.subscribe(() => {
      throw new Error('Observer')
    })
    const listener = vi.fn()
    const unsubscribe = f.refresh.subscribe(listener)
    unsubscribe()
    await f.refresh.request()
    expect(listener).not.toHaveBeenCalled()
    expect(f.refresh.getSnapshot()).toMatchObject({ revision: 1, error: null })
    f.refresh.dispose()
    f.settings.dispose()
  })
})
