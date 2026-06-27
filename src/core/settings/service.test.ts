import { describe, expect, it, vi } from 'vitest'
import { createSettingsService } from './service'
import { createMemorySettingsRepository } from './memoryRepository'
import {
  decodeTheme,
  settingsFailure,
  type SettingsRepository,
  type SettingsResult,
} from './types'

function fixture() {
  const repository: SettingsRepository = createMemorySettingsRepository()
  const read = vi.spyOn(repository, 'readTheme')
  const write = vi.spyOn(repository, 'writeTheme')
  const settings = createSettingsService(repository)
  return { settings, repository, read, write }
}
describe('settings decoding', () => {
  it('uses system for an absent record', () => {
    expect(decodeTheme(undefined)).toEqual({ ok: true, value: 'system' })
  })
  it.each(['system', 'light', 'dark'])('accepts schema v1 %s', (value) => {
    expect(decodeTheme({ key: 'theme', schemaVersion: 1, value })).toEqual({
      ok: true,
      value,
    })
  })
  it.each([
    null,
    {},
    { key: 'other', schemaVersion: 1, value: 'dark' },
    { key: 'theme', schemaVersion: 2, value: 'dark' },
    { key: 'theme', schemaVersion: 1, value: 'blue' },
  ])('rejects invalid records: %j', (raw) => {
    expect(decodeTheme(raw)).toMatchObject({
      ok: false,
      error: { code: 'CORRUPT_DATA' },
    })
  })
})
describe('settings service', () => {
  it('loads a saved choice without writing and ignores redundant updates', async () => {
    const f = fixture()
    await f.repository.writeTheme('dark')
    f.write.mockClear()
    await f.settings.load()
    expect(f.settings.getSnapshot().theme).toBe('dark')
    await f.settings.setTheme('dark')
    expect(f.write).not.toHaveBeenCalled()
    expect(Object.isFrozen(f.settings.getSnapshot())).toBe(true)
  })
  it('waits for commit, prevents concurrent writes, and publishes only after success', async () => {
    const f = fixture()
    let commit!: (result: SettingsResult<void>) => void
    f.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          commit = resolve
        }),
    )
    const save = f.settings.setTheme('dark')
    expect(f.settings.getSnapshot()).toMatchObject({
      theme: 'system',
      saving: true,
    })
    expect(await f.settings.setTheme('light')).toMatchObject({
      ok: false,
      error: { code: 'BUSY' },
    })
    commit({ ok: true, value: undefined })
    await save
    expect(f.settings.getSnapshot()).toMatchObject({
      theme: 'dark',
      saving: false,
    })
  })
  it('keeps the committed choice on failure and permits retry', async () => {
    const f = fixture()
    f.write.mockResolvedValueOnce(
      settingsFailure('STORAGE_UNAVAILABLE', 'Retry'),
    )
    expect((await f.settings.setTheme('dark')).ok).toBe(false)
    expect(f.settings.getSnapshot()).toMatchObject({
      theme: 'system',
      saving: false,
      error: 'Retry',
    })
    await f.settings.setTheme('dark')
    expect(f.settings.getSnapshot()).toMatchObject({
      theme: 'dark',
      error: null,
    })
  })
  it('defaults invalid data without overwriting until an explicit choice', async () => {
    const f = fixture()
    f.read.mockResolvedValueOnce(
      settingsFailure('CORRUPT_DATA', 'Invalid theme'),
    )
    expect((await f.settings.load()).ok).toBe(true)
    expect(f.settings.getSnapshot()).toMatchObject({
      theme: 'system',
      warning: 'Invalid theme',
    })
    expect(f.write).not.toHaveBeenCalled()
    await f.settings.setTheme('light')
    expect(f.settings.getSnapshot().warning).toBeNull()
  })
  it('reports read failures instead of pretending settings were loaded', async () => {
    const f = fixture()
    f.read.mockRejectedValueOnce(new Error('Denied'))
    expect(await f.settings.load()).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE' },
    })
    expect(f.write).not.toHaveBeenCalled()
  })
  it('does not publish a late save after dispose and removes listeners', async () => {
    const f = fixture()
    let commit!: (result: SettingsResult<void>) => void
    f.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          commit = resolve
        }),
    )
    const listener = vi.fn()
    f.settings.subscribe(listener)
    const save = f.settings.setTheme('dark')
    listener.mockClear()
    f.settings.dispose()
    commit({ ok: true, value: undefined })
    expect(await save).toMatchObject({ ok: false, error: { code: 'DISPOSED' } })
    expect(listener).not.toHaveBeenCalled()
    expect(f.settings.getSnapshot().theme).toBe('system')
    expect(await f.settings.setTheme('light')).toMatchObject({
      ok: false,
      error: { code: 'DISPOSED' },
    })
  })
  it('unsubscribe stops notifications', async () => {
    const f = fixture()
    const listener = vi.fn()
    const unsubscribe = f.settings.subscribe(listener)
    unsubscribe()
    await f.settings.setTheme('dark')
    expect(listener).not.toHaveBeenCalled()
  })
})

it('isolates listener errors from committed updates and subsequent writes', async () => {
  const report = vi.fn(() => {
    throw new Error('Reporter failed')
  })
  const settings = createSettingsService(
    createMemorySettingsRepository(),
    report,
  )
  settings.subscribe(() => {
    throw new Error('Observer failed')
  })
  const observer = vi.fn()
  settings.subscribe(observer)
  expect((await settings.setTheme('dark')).ok).toBe(true)
  expect(settings.getSnapshot()).toMatchObject({
    theme: 'dark',
    saving: false,
    error: null,
  })
  expect(report).toHaveBeenCalled()
  expect(observer).toHaveBeenCalled()
  expect((await settings.setTheme('light')).ok).toBe(true)
  settings.dispose()
})

it('blocks updates during a read and does not apply a late read after dispose', async () => {
  const repository = createMemorySettingsRepository()
  let finish!: (result: SettingsResult<'dark'>) => void
  vi.spyOn(repository, 'readTheme').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const settings = createSettingsService(repository)
  const loading = settings.load()
  expect(settings.getSnapshot().loading).toBe(true)
  expect(await settings.setTheme('light')).toMatchObject({
    ok: false,
    error: { code: 'BUSY' },
  })
  const idle = settings.whenIdle()
  settings.dispose()
  await idle
  finish({ ok: true, value: 'dark' })
  expect(await loading).toMatchObject({
    ok: false,
    error: { code: 'DISPOSED' },
  })
  expect(settings.getSnapshot().theme).toBe('system')
})
