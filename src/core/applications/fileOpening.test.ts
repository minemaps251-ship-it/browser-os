import { expect, it, vi } from 'vitest'
import { createFileOpeningService } from './fileOpening'
import { createTestRuntime, deferred, firstApp } from '../../test/fixtures'
import { createMemoryVfsRepository } from '../filesystem/memoryRepository'
import { createVfsService } from '../filesystem/service'
import { ROOT_NODE_ID } from '../filesystem/policy'
import type { ContentId, NodeId } from '../filesystem/types'
import type { ApplicationManifest } from './registry'
function filesystem() {
  let next = 0
  const repository = createMemoryVfsRepository({
    now: () => 1,
    createNodeId: () => `n-${++next}` as NodeId,
    createContentId: () => `c-${++next}` as ContentId,
    createOperationId: () => `op-${++next}`,
  })
  if (!repository.ok) throw new Error('Invalid fixture')
  return createVfsService(repository.value)
}
const handler: ApplicationManifest = {
  ...firstApp,
  fileAssociations: [{ mime: 'text/plain', default: true }],
}
it('deduplicates pending opens, restores existing file window after rename/move, and relaunches after close', async () => {
  const vfs = filesystem()
  const created = await vfs.createFile(ROOT_NODE_ID, 'one.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'hello',
  })
  if (!created.ok) throw new Error('Create failed')
  const gate = deferred<void>()
  const load = vi.fn(() => gate.promise)
  const runtime = createTestRuntime(load, [handler])
  const files = createFileOpeningService(runtime, vfs)
  const a = files.openFile(created.value)
  const b = files.openFile(created.value)
  expect(a).toBe(b)
  gate.resolve()
  const first = await a
  if (!first.ok) throw new Error(first.message)
  expect(runtime.listProcesses()[0].launchInput).toEqual({
    kind: 'file',
    fileId: created.value,
  })
  expect(Object.isFrozen(runtime.listProcesses()[0].launchInput)).toBe(true)
  await vfs.rename(created.value, 'renamed.txt')
  runtime.minimizeWindow(first.windowId)
  expect(await files.openFile(created.value)).toEqual(first)
  expect(runtime.windows.getState().byId[first.windowId]?.status).toBe(
    'visible',
  )
  expect(load).toHaveBeenCalledOnce()
  runtime.requestCloseWindow(first.windowId)
  const second = await files.openFile(created.value)
  expect(second.ok && second.windowId).not.toBe(first.windowId)
  expect(load).toHaveBeenCalledTimes(2)
  files.dispose()
  runtime.dispose()
})
it('does not launch for a directory, missing file or unsupported MIME and never reads content', async () => {
  const vfs = filesystem()
  const load = vi.fn(async () => {})
  const runtime = createTestRuntime(load)
  const files = createFileOpeningService(runtime, vfs)
  const created = await vfs.createFile(ROOT_NODE_ID, 'one.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!created.ok) throw new Error('Create failed')
  const read = vi.spyOn(vfs, 'readFile')
  expect(await files.openFile(ROOT_NODE_ID)).toMatchObject({
    ok: false,
    code: 'NOT_FILE',
  })
  expect(await files.openFile('missing' as NodeId)).toMatchObject({
    ok: false,
    code: 'NOT_FOUND',
  })
  expect(await files.openFile(created.value)).toMatchObject({
    ok: false,
    code: 'UNSUPPORTED',
  })
  expect(load).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
  files.dispose()
  runtime.dispose()
})
it('reports read/load failure, allows retry, and stops late work on disposal', async () => {
  const vfs = filesystem()
  const created = await vfs.createFile(ROOT_NODE_ID, 'one.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!created.ok) throw new Error('Create failed')
  const load = vi.fn(async () => {})
  load.mockRejectedValueOnce(new Error('private exception'))
  const runtime = createTestRuntime(load, [handler])
  const files = createFileOpeningService(runtime, vfs)
  expect(await files.openFile(created.value)).toMatchObject({
    ok: false,
    code: 'LAUNCH_FAILED',
  })
  expect(runtime.listProcesses()).toHaveLength(0)
  expect((await files.openFile(created.value)).ok).toBe(true)
  vi.spyOn(vfs, 'stat').mockRejectedValueOnce(new Error('private exception'))
  expect(await files.openFile(created.value)).toMatchObject({
    ok: false,
    code: 'READ_FAILED',
  })
  const gate = deferred<Awaited<ReturnType<typeof vfs.stat>>>()
  vi.spyOn(vfs, 'stat').mockReturnValueOnce(gate.promise)
  const pending = files.openFile(created.value)
  files.dispose()
  runtime.dispose()
  gate.resolve({ ok: false, error: { code: 'NOT_FOUND', message: 'missing' } })
  expect(await pending).toMatchObject({ ok: false, code: 'STOPPED' })
  expect(await files.openFile(created.value)).toMatchObject({
    ok: false,
    code: 'STOPPED',
  })
})
