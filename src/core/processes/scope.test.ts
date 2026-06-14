import { expect, it, vi } from 'vitest'
import { createProcessScope } from './scope'

it('aborts, runs all cleanup callbacks once, and isolates failures', () => {
  const onError = vi.fn()
  const scope = createProcessScope(onError)
  const good = vi.fn()
  scope.registerCleanup(() => {
    throw new Error('cleanup failure')
  })
  scope.registerCleanup(good)
  const unregistered = vi.fn()
  scope.registerCleanup(unregistered)()
  scope.dispose()
  scope.dispose()
  expect(scope.signal.aborted).toBe(true)
  expect(good).toHaveBeenCalledOnce()
  expect(onError).toHaveBeenCalledOnce()
  expect(unregistered).not.toHaveBeenCalled()
  const late = vi.fn()
  scope.registerCleanup(late)
  expect(late).toHaveBeenCalledOnce()
})

it('continues disposal even if the diagnostics handler throws', () => {
  const cleanup = vi.fn()
  const scope = createProcessScope(() => {
    throw new Error('diagnostics failure')
  })
  scope.registerCleanup(() => {
    throw new Error('cleanup failure')
  })
  scope.registerCleanup(cleanup)
  expect(() => scope.dispose()).not.toThrow()
  expect(cleanup).toHaveBeenCalledOnce()
})
