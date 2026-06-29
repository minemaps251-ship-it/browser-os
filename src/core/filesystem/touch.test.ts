import { expect, it, vi } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { createInitialNodes } from './seed'
import { ROOT_NODE_ID } from './policy'
import type { ContentId, NodeId } from './types'
it('updates time and metadata revision only, and rolls back an invalid clock', async () => {
  let clock = 1,
    next = 0
  const repository = createMemoryVfsRepository({
    now: () => clock,
    createNodeId: () => `n-${++next}` as NodeId,
    createContentId: () => `c-${++next}` as ContentId,
    createOperationId: () => `op-${++next}`,
  })
  if (!repository.ok) throw new Error('Invalid fixture')
  const vfs = createVfsService(repository.value)
  const created = await vfs.createFile(ROOT_NODE_ID, 'saved.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'hello',
  })
  if (!created.ok) throw new Error('Missing file')
  clock = 20
  expect(await vfs.touchFile(ROOT_NODE_ID, 'saved.txt')).toEqual(created)
  const before = await vfs.readFile(created.value)
  expect(before).toMatchObject({
    ok: true,
    value: {
      node: {
        updatedAt: 20,
        metadataRevision: 2,
        contentRevision: 1,
        byteLength: 5,
      },
    },
  })
  const listener = vi.fn()
  vfs.subscribe({ kind: 'all' }, listener)
  clock = Number.NaN
  expect(await vfs.touchFile(ROOT_NODE_ID, 'saved.txt')).toMatchObject({
    ok: false,
    error: { code: 'CORRUPT_DATA' },
  })
  expect(await vfs.readFile(created.value)).toEqual(before)
  expect(listener).not.toHaveBeenCalled()
})
it('rejects touching a protected existing file', async () => {
  let next = 0
  const id = 'protected-file' as NodeId,
    contentId = 'protected-content' as ContentId
  const repository = createMemoryVfsRepository({
    now: () => 2,
    createNodeId: () => `n-${++next}` as NodeId,
    createContentId: () => `c-${++next}` as ContentId,
    createOperationId: () => `op-${++next}`,
    initialNodes: [
      ...createInitialNodes(1, () => `seed-${++next}` as NodeId),
      {
        id,
        contentId,
        name: 'protected.txt',
        kind: 'file',
        parentId: ROOT_NODE_ID,
        createdAt: 1,
        updatedAt: 1,
        metadataRevision: 1,
        contentRevision: 1,
        byteLength: 0,
        mime: 'text/plain',
        metadata: { protected: true },
      },
    ],
    initialContents: [
      { id: contentId, content: { kind: 'text', encoding: 'utf-8', text: '' } },
    ],
  })
  if (!repository.ok) throw new Error(repository.error.message)
  expect(
    await repository.value.touchFile(ROOT_NODE_ID, 'protected.txt'),
  ).toMatchObject({ ok: false, error: { code: 'PROTECTED' } })
})
