import type { VfsResult } from '../core/filesystem/types'
import { describe, expect, it, vi } from 'vitest'
import { createBootController } from './boot'
import { createBrowserRuntime } from './createRuntime'
import { temporaryWorkspace } from './workspace'
import type { DatabaseConnection, StorageResult } from '../core/storage/types'

function fixture() {
  const close = vi.fn()
  const connection = { database: {} as IDBDatabase, closed: false, close }
  const runtime = createBrowserRuntime([], temporaryWorkspace())
  const dispose = vi.spyOn(runtime, 'dispose')
  const dependencies = {
    open: vi.fn(async (): Promise<StorageResult<DatabaseConnection>> => ({
      ok: true,
      value: connection,
    })),
    validate: vi.fn(async (): Promise<VfsResult<void>> => ({
      ok: true,
      value: undefined,
    })),
    createRuntime: vi.fn(() => runtime),
    temporary: vi.fn(temporaryWorkspace),
    initializeSettings: vi.fn(async () => ({
      ok: true as const,
      value: undefined,
    })),
  }
  return { connection, close, runtime, dispose, dependencies }
}
describe('workspace startup', () => {
  it('validates before exposing the runtime and disposes it once', async () => {
    const f = fixture()
    const boot = createBootController(f.dependencies)
    expect(boot.getSnapshot().status).toBe('loading')
    await boot.start()
    expect(f.dependencies.validate).toHaveBeenCalledWith(f.connection)
    expect(boot.getSnapshot()).toEqual({ status: 'ready', runtime: f.runtime })
    boot.dispose()
    boot.dispose()
    expect(f.dispose).toHaveBeenCalledTimes(1)
    expect(boot.getSnapshot().status).toBe('stopped')
  })
  it('does not silently choose memory when opening fails; retry can succeed', async () => {
    const f = fixture()
    f.dependencies.open.mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'Denied' },
    })
    const boot = createBootController(f.dependencies)
    await boot.start()
    expect(boot.getSnapshot().status).toBe('error')
    expect(f.dependencies.temporary).not.toHaveBeenCalled()
    await boot.start()
    expect(boot.getSnapshot().status).toBe('ready')
    boot.dispose()
  })
  it('closes a connection that arrives after disposal', async () => {
    const f = fixture()
    let resolve!: (value: StorageResult<DatabaseConnection>) => void
    f.dependencies.open.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const boot = createBootController(f.dependencies)
    const opening = boot.start()
    boot.dispose()
    resolve({ ok: true, value: f.connection })
    await opening
    expect(f.close).toHaveBeenCalledOnce()
    expect(f.dependencies.validate).not.toHaveBeenCalled()
    expect(f.dependencies.createRuntime).not.toHaveBeenCalled()
  })
  it('closes invalid data without creating a writable runtime', async () => {
    const f = fixture()
    f.dependencies.validate.mockRejectedValueOnce(new Error('Corrupt'))
    const boot = createBootController(f.dependencies)
    await boot.start()
    expect(f.close).toHaveBeenCalledOnce()
    expect(boot.getSnapshot().status).toBe('error')
    expect(f.dependencies.createRuntime).not.toHaveBeenCalled()
    boot.useTemporary()
    expect(f.dependencies.temporary).toHaveBeenCalledOnce()
    expect(boot.getSnapshot().status).toBe('ready')
    boot.dispose()
  })
})

it('supersedes an in-flight validation and keeps only the new attempt', async () => {
  const f = fixture()
  let finish!: () => void
  f.dependencies.validate.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve({ ok: true, value: undefined })
      }),
  )
  const boot = createBootController(f.dependencies)
  const first = boot.start()
  await Promise.resolve()
  const second = boot.start()
  expect(f.close).toHaveBeenCalled()
  await second
  finish()
  await first
  expect(f.dependencies.createRuntime).toHaveBeenCalledOnce()
  expect(boot.getSnapshot().status).toBe('ready')
  boot.dispose()
})

it('the runtime owns its single VFS resource and closes it once', () => {
  const workspace = temporaryWorkspace()
  const close = vi.spyOn(workspace, 'dispose')
  const runtime = createBrowserRuntime([], workspace)
  expect(runtime.vfs).toBe(workspace.vfs)
  runtime.dispose()
  runtime.dispose()
  expect(close).toHaveBeenCalledOnce()
})

it('preserves data and closes the resource when settings cannot be loaded', async () => {
  const f = fixture()
  f.dependencies.initializeSettings.mockRejectedValueOnce(
    new Error('Settings unavailable'),
  )
  const boot = createBootController(f.dependencies)
  await boot.start()
  expect(boot.getSnapshot().status).toBe('error')
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.dependencies.createRuntime).not.toHaveBeenCalled()
  boot.dispose()
})

it.each([
  'UNAVAILABLE',
  'BLOCKED',
  'TIMEOUT',
  'NEWER_DATABASE',
  'CORRUPT_SCHEMA',
  'OPEN_FAILED',
] as const)(
  'classifies %s without exposing raw errors or creating a runtime',
  async (code) => {
    const f = fixture()
    f.dependencies.open.mockResolvedValueOnce({
      ok: false,
      error: { code, message: 'RAW_PRIVATE_DATABASE_ERROR' },
    })
    const boot = createBootController(f.dependencies)
    await boot.start()
    const state = boot.getSnapshot()
    expect(state).toMatchObject({ status: 'error', reason: code })
    if (state.status !== 'error') throw new Error('Expected recovery')
    expect(state.message).not.toContain('RAW_PRIVATE')
    expect(state.guidance.action).toBeTruthy()
    expect(f.dependencies.createRuntime).not.toHaveBeenCalled()
    expect(f.dependencies.temporary).not.toHaveBeenCalled()
    boot.dispose()
  },
)

it.each(['CORRUPT_DATA', 'STORAGE_UNAVAILABLE'] as const)(
  'classifies failed %s validation and closes the resource',
  async (code) => {
    const f = fixture()
    f.dependencies.validate.mockResolvedValueOnce({
      ok: false,
      error: { code, message: 'Invalid' },
    })
    const boot = createBootController(f.dependencies)
    await boot.start()
    expect(boot.getSnapshot()).toMatchObject({
      status: 'error',
      reason: code === 'CORRUPT_DATA' ? 'CORRUPT_DATA' : 'READ_FAILED',
    })
    expect(f.close).toHaveBeenCalledOnce()
    expect(f.dependencies.createRuntime).not.toHaveBeenCalled()
    boot.dispose()
  },
)
