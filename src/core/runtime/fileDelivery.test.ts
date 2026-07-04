import { expect, it, vi } from 'vitest'
import { createTestRuntime, deferred, firstApp } from '../../test/fixtures'
import type { ApplicationManifest } from '../applications/registry'
import type { NodeId } from '../filesystem/types'
const manifest: ApplicationManifest = {
  ...firstApp,
  fileAssociations: [{ mime: 'text/plain' }],
  fileOpenPolicy: 'reuse-window',
}
const one = 'one' as NodeId,
  two = 'two' as NodeId
it('shares cold launches and queues different file requests until the receiver mounts', async () => {
  const gate = deferred<void>()
  const load = vi.fn(() => gate.promise)
  const runtime = createTestRuntime(load, [manifest])
  try {
    const first = runtime.launch(manifest.id, { kind: 'file', fileId: one })
    const second = runtime.launch(manifest.id, { kind: 'file', fileId: two })
    gate.resolve()
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual(b)
    expect(load).toHaveBeenCalledOnce()
    if (!a.ok) throw new Error(a.message)
    const receive = vi.fn(() => true)
    const off = runtime.registerFileReceiver(a.processId, receive)
    expect(receive).toHaveBeenCalledExactlyOnceWith(two)
    runtime.minimizeWindow(a.windowId)
    expect(
      await runtime.launch(manifest.id, { kind: 'file', fileId: one }),
    ).toEqual(a)
    expect(receive).toHaveBeenLastCalledWith(one)
    expect(runtime.windows.getState().byId[a.windowId]?.status).toBe('visible')
    off()
    await runtime.launch(manifest.id, { kind: 'file', fileId: two })
    const replacement = vi.fn(() => true)
    runtime.registerFileReceiver(a.processId, replacement)
    expect(replacement).toHaveBeenCalledExactlyOnceWith(two)
  } finally {
    runtime.dispose()
  }
})
it('does not bypass a busy receiver and removes delivery on crash/close/dispose', async () => {
  const runtime = createTestRuntime(undefined, [manifest])
  try {
    const first = await runtime.launch(manifest.id)
    if (!first.ok) throw new Error(first.message)
    const receive = vi.fn(() => false)
    runtime.registerFileReceiver(first.processId, receive)
    expect(
      await runtime.launch(manifest.id, { kind: 'file', fileId: one }),
    ).toMatchObject({ ok: false })
    expect(runtime.listProcesses()).toHaveLength(1)
    runtime.reportCrash(first.windowId)
    const next = await runtime.launch(manifest.id)
    if (!next.ok) throw new Error(next.message)
    expect(next.processId).not.toBe(first.processId)
    const newReceiver = vi.fn(() => true)
    runtime.registerFileReceiver(next.processId, newReceiver)
    expect(
      await runtime.launch(manifest.id, { kind: 'file', fileId: two }),
    ).toEqual(next)
    expect(newReceiver).toHaveBeenCalledExactlyOnceWith(two)
    expect(receive).toHaveBeenCalledOnce()
    runtime.requestCloseWindow(next.windowId)
    runtime.dispose()
    expect(
      await runtime.launch(manifest.id, { kind: 'file', fileId: two }),
    ).toMatchObject({ ok: false })
    expect(newReceiver).toHaveBeenCalledOnce()
  } finally {
    runtime.dispose()
  }
})

it('bounds pre-mount delivery and rejects a full inbox without starting another process', async () => {
  const runtime = createTestRuntime(undefined, [manifest])
  try {
    const first = await runtime.launch(manifest.id)
    if (!first.ok) throw new Error(first.message)
    for (let index = 0; index < 16; index++)
      expect(
        await runtime.launch(manifest.id, {
          kind: 'file',
          fileId: `queued-${index}` as NodeId,
        }),
      ).toEqual(first)
    expect(
      await runtime.launch(manifest.id, {
        kind: 'file',
        fileId: 'overflow' as NodeId,
      }),
    ).toMatchObject({ ok: false })
    const receive = vi.fn(() => true)
    runtime.registerFileReceiver(first.processId, receive)
    expect(receive).toHaveBeenCalledTimes(16)
    expect(runtime.listProcesses()).toHaveLength(1)
  } finally {
    runtime.dispose()
  }
})
