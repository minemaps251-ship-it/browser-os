import { createMemoryVfsRepository } from './memoryRepository'
import { defineVfsRepositoryContract } from '../../test/vfs/contract'
import type { ContentId, NodeId } from './types'

defineVfsRepositoryContract('memory', () => {
  let node = 0,
    content = 0,
    operation = 0,
    time = 0
  const result = createMemoryVfsRepository({
    now: () => ++time,
    createNodeId: () => `contract-node-${++node}` as NodeId,
    createContentId: () => `contract-content-${++content}` as ContentId,
    createOperationId: () => `contract-operation-${++operation}`,
  })
  if (!result.ok) throw new Error(result.error.message)
  return { repository: result.value, dispose: () => {} }
})
