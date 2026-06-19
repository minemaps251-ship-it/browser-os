import { parsePath } from './paths'
import type { VfsRepository } from './repository'
import type { NodeId, VfsResult, FileContent } from './types'

export function createVfsService(repository: VfsRepository) {
  return {
    createDirectory: (parentId: NodeId, name: string) =>
      repository.createDirectory(parentId, name),
    createFile: (parentId: NodeId, name: string, content: FileContent) =>
      repository.createFile(parentId, name, content),
    readFile: (id: NodeId) => repository.readDocument(id),
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
