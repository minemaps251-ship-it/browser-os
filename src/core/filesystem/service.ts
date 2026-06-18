import { parsePath } from './paths'
import type { VfsReadRepository } from './repository'
import type { NodeId, VfsResult } from './types'

export function createVfsService(repository: VfsReadRepository) {
  return {
    stat: (id: NodeId) => repository.getNode(id),
    listDirectory: (id: NodeId) => repository.getChildren(id),
    pathOf: (id: NodeId) => repository.pathOf(id),
    async resolve(path: string, cwd: NodeId): Promise<VfsResult<NodeId>> {
      const parsed = parsePath(path)
      if (!parsed.ok) return parsed
      const result = await repository.resolvePath(parsed.value, cwd)
      return result.ok
        ? result
        : { ok: false, error: { ...result.error, path } }
    },
  }
}
export type VirtualFileSystem = ReturnType<typeof createVfsService>
