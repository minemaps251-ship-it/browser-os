import { createVfsService } from '../core/filesystem/service'
import { createMemoryVfsRepository } from '../core/filesystem/memoryRepository'
import { createIndexedDbVfsRepository } from '../core/storage/createRepository'
import type { ContentId, NodeId } from '../core/filesystem/types'
import type { DatabaseConnection } from '../core/storage/types'

const options = {
  now: Date.now,
  createNodeId: () => crypto.randomUUID() as NodeId,
  createContentId: () => crypto.randomUUID() as ContentId,
  createOperationId: () => crypto.randomUUID(),
}
export interface Workspace {
  readonly vfs: ReturnType<typeof createVfsService>
  readonly mode: 'persistent' | 'temporary'
  dispose(): void
}
export function persistentWorkspace(connection: DatabaseConnection): Workspace {
  return {
    vfs: createVfsService(createIndexedDbVfsRepository(connection, options)),
    mode: 'persistent',
    dispose: () => connection.close(),
  }
}
export function temporaryWorkspace(): Workspace {
  const repository = createMemoryVfsRepository(options)
  if (!repository.ok) throw new Error(repository.error.message)
  return {
    vfs: createVfsService(repository.value),
    mode: 'temporary',
    dispose() {},
  }
}
