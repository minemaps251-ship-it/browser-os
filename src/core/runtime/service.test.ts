import { describe, expect, it, vi } from 'vitest'
import { createTestRuntime, deferred, firstApp } from '../../test/fixtures'
import type { AppId, WindowId } from '../shared/ids'

describe('application lifecycle', () => {
  it('launches separate instances, focuses, closes, and releases resources', async () => {
    const cleanup = vi.fn()
    const runtime = createTestRuntime(async (_app, scope) => {
      scope.registerCleanup(cleanup)
    })
    const first = await runtime.launch(firstApp.id)
    const second = await runtime.launch(firstApp.id)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('Fixture launch failed')
    expect(first.processId).not.toBe(second.processId)
    expect(first.windowId).not.toBe(second.windowId)
    expect(runtime.windows.getState().byId[first.windowId]?.processId).toBe(
      first.processId,
    )
    runtime.focusWindow(first.windowId)
    runtime.requestCloseWindow(first.windowId)
    expect(runtime.windows.getState().focusedId).toBe(second.windowId)
    expect(runtime.listProcesses()).toHaveLength(1)
    expect(cleanup).toHaveBeenCalledOnce()
    runtime.requestCloseWindow(first.windowId)
    runtime.dispose()
    expect(runtime.listProcesses()).toEqual([])
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
  it('deduplicates concurrent singleton launches and focuses the existing window', async () => {
    const gate = deferred<void>()
    const load = vi.fn(() => gate.promise)
    const runtime = createTestRuntime(load, [
      { ...firstApp, instancePolicy: 'singleton' },
    ])
    const a = runtime.launch(firstApp.id)
    const b = runtime.launch(firstApp.id)
    expect(a).toBe(b)
    gate.resolve()
    expect(await a).toEqual(await b)
    expect(await runtime.launch(firstApp.id)).toEqual(await a)
    expect(load).toHaveBeenCalledOnce()
    expect(runtime.listProcesses()).toHaveLength(1)
    runtime.dispose()
  })
  it('rolls back failed launches and permits a retry', async () => {
    const cleanup = vi.fn()
    const runtime = createTestRuntime(async (_app, scope) => {
      scope.registerCleanup(cleanup)
      throw new Error('load failure')
    })
    expect((await runtime.launch(firstApp.id)).ok).toBe(false)
    expect(runtime.listProcesses()).toEqual([])
    expect(runtime.windows.getState().order).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
    expect((await runtime.launch(firstApp.id)).ok).toBe(false)
    expect(cleanup).toHaveBeenCalledTimes(2)
    runtime.dispose()
  })
  it('never resurrects a late launch after runtime disposal', async () => {
    const gate = deferred<void>()
    const runtime = createTestRuntime(() => gate.promise)
    const result = runtime.launch(firstApp.id)
    runtime.dispose()
    gate.resolve()
    expect((await result).ok).toBe(false)
    expect(runtime.windows.getState().order).toEqual([])
    expect(runtime.listProcesses()).toEqual([])
  })
  it('rejects unknown apps and disposed runtime launches without side effects', async () => {
    const runtime = createTestRuntime()
    expect((await runtime.launch('unknown' as AppId)).ok).toBe(false)
    runtime.requestCloseWindow('unknown' as WindowId)
    runtime.dispose()
    expect((await runtime.launch(firstApp.id)).ok).toBe(false)
    expect(runtime.listProcesses()).toEqual([])
  })
  it('marks renderer crashes and disposes app resources while retaining closeable chrome', async () => {
    const cleanup = vi.fn()
    const runtime = createTestRuntime(async (_app, scope) => {
      scope.registerCleanup(cleanup)
    })
    const result = await runtime.launch(firstApp.id)
    if (!result.ok) throw new Error('Fixture launch failed')
    runtime.reportCrash(result.windowId)
    expect(runtime.listProcesses()[0].status).toBe('crashed')
    expect(runtime.windows.getState().byId[result.windowId]).toBeDefined()
    expect(cleanup).toHaveBeenCalledOnce()
    runtime.requestCloseWindow(result.windowId)
    expect(runtime.listProcesses()).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
    runtime.dispose()
  })
})

it('deduplicates guarded closes, permits cancel/retry, and keeps synchronous unguarded close', async () => {
  const runtime = createTestRuntime()
  const result = await runtime.launch(firstApp.id)
  if (!result.ok) throw new Error('Missing window')
  const first = deferred<boolean>()
  const guard = vi.fn(() => first.promise)
  const off = runtime.registerCloseGuard(result.processId, guard)
  const a = runtime.requestCloseWindow(result.windowId)
  expect(runtime.requestCloseWindow(result.windowId)).toBe(a)
  await Promise.resolve()
  expect(guard).toHaveBeenCalledOnce()
  first.resolve(false)
  expect(await a).toBe(false)
  expect(runtime.listProcesses()).toHaveLength(1)
  off()
  runtime.requestCloseWindow(result.windowId)
  expect(runtime.listProcesses()).toHaveLength(0)
  runtime.dispose()
})
it('denies throwing guards and ignores stale approvals after unregister or disposal', async () => {
  for (const action of ['unregister', 'dispose', 'crash'] as const) {
    const runtime = createTestRuntime()
    const result = await runtime.launch(firstApp.id)
    if (!result.ok) throw new Error('Missing window')
    const offError = runtime.registerCloseGuard(result.processId, async () => {
      throw new Error('failed')
    })
    expect(await runtime.requestCloseWindow(result.windowId)).toBe(false)
    offError()
    const gate = deferred<boolean>()
    const off = runtime.registerCloseGuard(result.processId, () => gate.promise)
    const pending = runtime.requestCloseWindow(result.windowId)
    await Promise.resolve()
    if (action === 'unregister') off()
    if (action === 'dispose') runtime.dispose()
    if (action === 'crash') runtime.reportCrash(result.windowId)
    gate.resolve(true)
    expect(await pending).toBe(false)
    expect(runtime.listProcesses().length).toBe(action === 'dispose' ? 0 : 1)
    runtime.dispose()
  }
})

it('tracks the current document independently from immutable launch input and rejects inactive bindings', async () => {
  const runtime = createTestRuntime(async () => {}, [
    { ...firstApp, fileAssociations: [{ mime: 'text/plain' }] },
  ])
  const launched = await runtime.launch(firstApp.id)
  if (!launched.ok) throw new Error('Missing process')
  const node = 'saved-file' as import('../filesystem/types').NodeId
  expect(runtime.listProcesses()[0].documentFileId).toBeNull()
  expect(runtime.bindProcessDocument(launched.processId, node)).toBe(true)
  expect(runtime.listProcesses()[0]).toMatchObject({
    documentFileId: node,
    launchInput: { kind: 'default' },
  })
  runtime.reportCrash(launched.windowId)
  expect(runtime.bindProcessDocument(launched.processId, node)).toBe(false)
  runtime.dispose()
  expect(runtime.bindProcessDocument(launched.processId, node)).toBe(false)
  const noHandler = createTestRuntime()
  const other = await noHandler.launch(firstApp.id)
  if (!other.ok) throw new Error('Missing process')
  expect(noHandler.bindProcessDocument(other.processId, node)).toBe(false)
  noHandler.dispose()
})

it('never invokes a queued close guard invalidated before its microtask', async () => {
  for (const action of ['unregister', 'dispose', 'crash'] as const) {
    const runtime = createTestRuntime()
    const result = await runtime.launch(firstApp.id)
    if (!result.ok) throw new Error('Missing window')
    const guard = vi.fn(async () => true)
    const off = runtime.registerCloseGuard(result.processId, guard)
    const pending = runtime.requestCloseWindow(result.windowId)
    if (action === 'unregister') off()
    if (action === 'dispose') runtime.dispose()
    if (action === 'crash') runtime.reportCrash(result.windowId)
    expect(await pending).toBe(false)
    expect(guard).not.toHaveBeenCalled()
    if (action === 'crash') {
      runtime.registerCloseGuard(result.processId, guard)
      runtime.requestCloseWindow(result.windowId)
      expect(runtime.listProcesses()).toEqual([])
      expect(guard).not.toHaveBeenCalled()
    }
    runtime.dispose()
  }
})

it('repeated singleton crash/relaunch/close releases each scope once despite cleanup failures', async () => {
  const cleanups: ReturnType<typeof vi.fn>[] = []
  const signals: AbortSignal[] = []
  const runtime = createTestRuntime(
    async (_app, scope) => {
      signals.push(scope.signal)
      scope.registerCleanup(() => {
        throw new Error('Failed resource cleanup')
      })
      const cleanup = vi.fn()
      cleanups.push(cleanup)
      scope.registerCleanup(cleanup)
    },
    [{ ...firstApp, instancePolicy: 'singleton' }],
  )
  for (let cycle = 0; cycle < 20; cycle++) {
    const first = await runtime.launch(firstApp.id)
    if (!first.ok) throw new Error('Missing window')
    runtime.reportCrash(first.windowId)
    runtime.reportCrash(first.windowId)
    const restarted = await runtime.launch(firstApp.id)
    if (!restarted.ok) throw new Error('Missing restart')
    expect(restarted.processId).not.toBe(first.processId)
    runtime.requestCloseWindow(first.windowId)
    runtime.requestCloseWindow(restarted.windowId)
    expect(runtime.listProcesses()).toEqual([])
    expect(runtime.windows.getState().order).toEqual([])
  }
  runtime.dispose()
  runtime.dispose()
  expect(signals.every((signal) => signal.aborted)).toBe(true)
  expect(cleanups).toHaveLength(40)
  for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce()
})
