import { expect, it, vi } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { ROOT_NODE_ID } from './policy'
import type {
  ContentId,
  FileContent,
  NodeId,
  VfsChange,
  VfsResult,
} from './types'
function value<T>(result: VfsResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const text = (text: string): FileContent => ({
  kind: 'text',
  encoding: 'utf-8',
  text,
})
async function fixture() {
  let n = 0,
    c = 0,
    op = 0
  const errors = vi.fn()
  const options = {
    now: () => 1,
    createNodeId: () => `node-${++n}` as NodeId,
    createContentId: () => `content-${++c}` as ContentId,
    createOperationId: () => `op-${++op}`,
    onListenerError: errors,
  }
  const repository = value(createMemoryVfsRepository(options))
  const vfs = createVfsService(repository)
  const docs = value(await vfs.resolve('/home/user/Documents', ROOT_NODE_ID))
  const desktop = value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID))
  return { vfs, repository, options, errors, docs, desktop }
}
it('emits one immutable committed invalidation per create/copy with distinct operation IDs', async () => {
  const { vfs, docs, desktop } = await fixture()
  const events: VfsChange[] = []
  const observed: Promise<VfsResult<unknown>>[] = []
  vfs.subscribe({ kind: 'all' }, (event) => {
    events.push(event)
    observed.push(vfs.stat(event.pathIds[0]))
  })
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const file = value(await vfs.createFile(folder, 'file', text('hello')))
  const copy = value(await vfs.copyFile(file, desktop))
  expect(events).toHaveLength(3)
  expect(events[0]).toMatchObject({
    metadataIds: [folder, docs],
    contentIds: [],
    pathIds: [folder],
    directoryIds: [docs],
    removedIds: [],
  })
  expect(events[1].contentIds).toEqual([file])
  expect(events[2].contentIds).toEqual([copy])
  expect(events[2].metadataIds).not.toContain(file)
  expect(new Set(events.map((event) => event.operationId)).size).toBe(3)
  expect(
    events.every((event) => event.originRequestId === event.operationId),
  ).toBe(true)
  expect((await Promise.all(observed)).every((result) => result.ok)).toBe(true)
  for (const event of events) {
    expect(Object.isFrozen(event)).toBe(true)
    for (const ids of [
      event.metadataIds,
      event.contentIds,
      event.pathIds,
      event.directoryIds,
      event.removedIds,
    ])
      expect(Object.isFrozen(ids)).toBe(true)
  }
})
it('delivers write correlation before Promise resolution and invalidates directory size metadata', async () => {
  const { vfs, docs } = await fixture()
  const file = value(await vfs.createFile(docs, 'file', text('old')))
  const events: VfsChange[] = []
  const directory = vi.fn()
  vfs.subscribe({ kind: 'node', id: file }, (event) => {
    events.push(event)
  })
  vfs.subscribe({ kind: 'directory', id: docs }, directory)
  const pending = vfs.writeFile(file, text('new'), {
    expectedContentRevision: 1,
    requestId: 'own-save',
  })
  expect(events).toHaveLength(1)
  const receipt = value(await pending)
  expect(events[0]).toMatchObject({
    operationId: receipt.operationId,
    originRequestId: 'own-save',
    metadataIds: [file],
    contentIds: [file],
    pathIds: [],
    directoryIds: [docs],
  })
  expect(directory).toHaveBeenCalledTimes(1)
})
it('scopes node and directory subscriptions to affected targets and unsubscribes idempotently', async () => {
  const { vfs, docs, desktop } = await fixture()
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const a = value(await vfs.createFile(folder, 'a', text('a')))
  const b = value(await vfs.createFile(folder, 'b', text('b')))
  const node = vi.fn(),
    directory = vi.fn(),
    other = vi.fn()
  const unsubscribe = vfs.subscribe({ kind: 'node', id: a }, node)
  vfs.subscribe({ kind: 'directory', id: folder }, directory)
  vfs.subscribe({ kind: 'directory', id: desktop }, other)
  value(
    await vfs.writeFile(b, text('new'), {
      expectedContentRevision: 1,
      requestId: 'other-save',
    }),
  )
  expect(node).not.toHaveBeenCalled()
  expect(directory).toHaveBeenCalledTimes(1)
  expect(other).not.toHaveBeenCalled()
  value(await vfs.rename(a, 'renamed'))
  expect(node).toHaveBeenCalledTimes(1)
  unsubscribe()
  unsubscribe()
  value(await vfs.remove(a, { recursive: false }))
  expect(node).toHaveBeenCalledTimes(1)
})
it('invalidates descendant paths on folder rename/move without content notifications', async () => {
  const { vfs, docs, desktop } = await fixture()
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const child = value(await vfs.createDirectory(folder, 'child'))
  const file = value(await vfs.createFile(child, 'file', text('hello')))
  const events: VfsChange[] = []
  const directory = vi.fn()
  vfs.subscribe({ kind: 'node', id: file }, (event) => {
    events.push(event)
  })
  vfs.subscribe({ kind: 'directory', id: child }, directory)
  value(await vfs.rename(folder, 'renamed'))
  value(await vfs.move(folder, desktop))
  expect(events).toHaveLength(2)
  expect(directory).toHaveBeenCalledTimes(2)
  expect(events[0].pathIds).toEqual(
    expect.arrayContaining([folder, child, file]),
  )
  expect(events[0].metadataIds).toEqual([folder, docs])
  expect(events[1].directoryIds).toEqual([docs, desktop])
  expect(events.every((event) => event.contentIds.length === 0)).toBe(true)
})
it('notifies removed descendants and the surviving parent in one event', async () => {
  const { vfs, docs } = await fixture()
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const file = value(await vfs.createFile(folder, 'file', text('hello')))
  const events: VfsChange[] = []
  const child = vi.fn(),
    parent = vi.fn()
  vfs.subscribe({ kind: 'all' }, (event) => {
    events.push(event)
  })
  vfs.subscribe({ kind: 'node', id: file }, child)
  vfs.subscribe({ kind: 'directory', id: docs }, parent)
  value(await vfs.remove(folder, { recursive: true }))
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    removedIds: [folder, file],
    metadataIds: [docs],
    directoryIds: [docs],
    contentIds: [],
  })
  expect(child).toHaveBeenCalledTimes(1)
  expect(parent).toHaveBeenCalledTimes(1)
})
it('does not notify on failed operations, stale writes, reads or no-op relocation', async () => {
  const { vfs, docs } = await fixture()
  const file = value(await vfs.createFile(docs, 'file', text('hello')))
  const listener = vi.fn()
  vfs.subscribe({ kind: 'all' }, listener)
  await vfs.readFile(file)
  await vfs.rename(file, 'file')
  await vfs.move(file, docs)
  await vfs.createFile(docs, 'file', text('duplicate'))
  await vfs.rename(file, 'bad/name')
  await vfs.writeFile(file, text('stale'), {
    expectedContentRevision: 2,
    requestId: 'stale',
  })
  await vfs.remove(ROOT_NODE_ID, { recursive: true })
  expect(listener).not.toHaveBeenCalled()
})
it.each(['throw', 'empty'] as const)(
  'rolls back operations and emits nothing when operation ID is %s',
  async (kind) => {
    const { vfs, docs, desktop, options } = await fixture()
    const file = value(await vfs.createFile(docs, 'file', text('hello')))
    const before = value(await vfs.readFile(file))
    const parent = value(await vfs.stat(docs))
    const listener = vi.fn()
    vfs.subscribe({ kind: 'all' }, listener)
    options.createOperationId = () => {
      if (kind === 'throw') throw new Error('identity')
      return ''
    }
    for (const result of [
      await vfs.createDirectory(docs, 'new'),
      await vfs.copyFile(file, desktop),
      await vfs.rename(file, 'renamed'),
      await vfs.remove(file, { recursive: false }),
      await vfs.writeFile(file, text('new'), {
        expectedContentRevision: 1,
        requestId: 'save',
      }),
    ])
      expect(result.ok).toBe(false)
    expect(listener).not.toHaveBeenCalled()
    expect(value(await vfs.readFile(file))).toEqual(before)
    expect(value(await vfs.stat(docs))).toBe(parent)
    expect(value(await vfs.listDirectory(desktop))).toEqual([])
  },
)
it('isolates synchronous, asynchronous and diagnostic failures from committed success', async () => {
  const { vfs, docs, errors } = await fixture()
  const failure = new Error('listener')
  vfs.subscribe({ kind: 'all' }, () => {
    throw failure
  })
  vfs.subscribe({ kind: 'all' }, async () => {
    throw failure
  })
  const healthy = vi.fn()
  vfs.subscribe({ kind: 'all' }, healthy)
  errors.mockImplementation(() => {
    throw new Error('diagnostic')
  })
  const file = value(await vfs.createFile(docs, 'file', text('hello')))
  expect((await vfs.stat(file)).ok).toBe(true)
  expect(healthy).toHaveBeenCalledTimes(1)
  expect(errors).toHaveBeenCalledTimes(2)
})
it('queues reentrant mutation notifications in commit order', async () => {
  const { vfs, docs } = await fixture()
  const order: string[] = []
  let nested: Promise<VfsResult<NodeId>> | undefined
  vfs.subscribe({ kind: 'all' }, (event) => {
    order.push(`a:${event.operationId}`)
    if (!nested) nested = vfs.createDirectory(docs, 'nested')
  })
  vfs.subscribe({ kind: 'all' }, (event) => {
    order.push(`b:${event.operationId}`)
  })
  value(await vfs.createDirectory(docs, 'first'))
  value(await nested!)
  expect(order).toEqual(['a:op-1', 'b:op-1', 'a:op-2', 'b:op-2'])
})
it('honors unsubscribe during delivery and excludes new subscriptions from the current event', async () => {
  const { vfs, docs } = await fixture()
  const late = vi.fn(),
    removed = vi.fn()
  let registered = false
  let unsubscribe = () => {}
  vfs.subscribe({ kind: 'all' }, () => {
    unsubscribe()
    if (!registered) {
      vfs.subscribe({ kind: 'all' }, late)
      registered = true
    }
  })
  unsubscribe = vfs.subscribe({ kind: 'all' }, removed)
  value(await vfs.createDirectory(docs, 'first'))
  expect(removed).not.toHaveBeenCalled()
  expect(late).not.toHaveBeenCalled()
  value(await vfs.createDirectory(docs, 'second'))
  expect(late).toHaveBeenCalledTimes(1)
})
it('shares subscriptions across services over the same repository', async () => {
  const { vfs, repository, docs } = await fixture()
  const second = createVfsService(repository)
  const listener = vi.fn()
  vfs.subscribe({ kind: 'directory', id: docs }, listener)
  value(await second.createDirectory(docs, 'from-second'))
  expect(listener).toHaveBeenCalledTimes(1)
})
