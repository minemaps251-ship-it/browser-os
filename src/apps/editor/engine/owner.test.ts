import { expect, it, vi } from 'vitest'
import { createEngineOwner } from './owner'
import type { EngineModule, EnginePool } from './types'
function fixture() {
  const pool: EnginePool = { retain: vi.fn(), mount: vi.fn(), dispose: vi.fn() }
  const createEnginePool = vi.fn(() => pool)
  let resolve!: (module: EngineModule) => void
  const load = vi.fn(
    () =>
      new Promise<EngineModule>((done) => {
        resolve = done
      }),
  )
  return {
    pool,
    createEnginePool,
    resolve: () => resolve({ createEnginePool }),
    owner: createEngineOwner(load),
    load,
  }
}
it('loads once, applies latest tabs and disposes per-window resources once', async () => {
  const f = fixture()
  f.owner.retain(['one'])
  const first = f.owner.get(),
    second = f.owner.get()
  expect(first).toBe(second)
  f.owner.retain(['two'])
  f.resolve()
  expect(await first).toBe(f.pool)
  expect(f.pool.retain).toHaveBeenLastCalledWith(['two'])
  expect(await f.owner.get()).toBe(f.pool)
  expect(f.load).toHaveBeenCalledTimes(1)
  f.owner.retain([])
  expect(f.pool.retain).toHaveBeenLastCalledWith([])
  f.owner.dispose()
  f.owner.dispose()
  expect(f.pool.dispose).toHaveBeenCalledTimes(1)
  await expect(f.owner.get()).rejects.toThrow('closed')
})
it('does not create a pool when lazy import resolves after window close', async () => {
  const f = fixture()
  const operation = f.owner.get()
  f.owner.dispose()
  f.resolve()
  await expect(operation).rejects.toThrow('closed')
  expect(f.createEnginePool).not.toHaveBeenCalled()
})
it('clears a rejected import so a subsequent explicit attempt may retry', async () => {
  const pool: EnginePool = { retain: vi.fn(), mount: vi.fn(), dispose: vi.fn() }
  const load = vi
    .fn<() => Promise<EngineModule>>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ createEnginePool: () => pool })
  const owner = createEngineOwner(load)
  await expect(owner.get()).rejects.toThrow('offline')
  expect(await owner.get()).toBe(pool)
  owner.dispose()
})
