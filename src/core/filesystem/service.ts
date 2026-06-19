import { parsePath } from './paths'
import type { VfsRepository } from './repository'
import type {
  NodeId,
  VfsResult,
  FileContent,
  WriteOptions,
  RemoveOptions,
  VfsChangeScope,
  VfsChangeListener,
} from './types'

export function createVfsService(repository: VfsRepository) {
  return {
    subscribe: (scope: VfsChangeScope, listener: VfsChangeListener) =>
      repository.subscribe(scope, listener),
    remove: (id: NodeId, options: RemoveOptions) =>
      repository.remove(id, options),
    copyFile: (id: NodeId, destination: NodeId, newName?: string) =>
      repository.copyFile(id, destination, newName),
    rename: (id: NodeId, name: string) => repository.rename(id, name),
    move: (id: NodeId, destination: NodeId, newName?: string) =>
      repository.move(id, destination, newName),
    createDirectory: (parentId: NodeId, name: string) =>
      repository.createDirectory(parentId, name),
    createFile: (parentId: NodeId, name: string, content: FileContent) =>
      repository.createFile(parentId, name, content),
    writeFile: (id: NodeId, content: FileContent, options: WriteOptions) =>
      repository.writeFile(id, content, options),
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
