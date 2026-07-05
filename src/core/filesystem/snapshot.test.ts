import { expect, it } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { ROOT_NODE_ID } from './policy'
import type { ContentId, NodeId } from './types'
it('captures immutable committed metadata/content that cannot change after write or remove', async () => {
  let next = 0
  const result = createMemoryVfsRepository({
    now: () => 1,
    createNodeId: () => `node-${++next}` as NodeId,
    createContentId: () => `content-${++next}` as ContentId,
    createOperationId: () => `operation-${++next}`,
  })
  if (!result.ok) throw new Error(result.error.message)
  const repository = result.value
  const created = await repository.createFile(ROOT_NODE_ID, 'source.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'before',
  })
  if (!created.ok) throw new Error(created.error.message)
  const copy = repository.snapshot()
  expect(Object.isFrozen(copy.nodes)).toBe(true)
  expect(Object.isFrozen(copy.contents)).toBe(true)
  expect(Object.isFrozen(copy.contents[0].content)).toBe(true)
  await repository.writeFile(
    created.value,
    { kind: 'text', encoding: 'utf-8', text: 'after' },
    { expectedContentRevision: 1, requestId: 'save' },
  )
  expect(repository.snapshot().contents[0].content.text).toBe('after')
  expect(copy.contents[0].content.text).toBe('before')
  const oldNode = copy.nodes.find((node) => node.id === created.value)
  expect(oldNode).toMatchObject({ contentRevision: 1, byteLength: 6 })
  await repository.remove(created.value, { recursive: false })
  expect(copy.nodes).toContain(oldNode)
  expect(repository.snapshot().contents).toHaveLength(0)
})
