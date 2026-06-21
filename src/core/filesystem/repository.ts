import type { ParsedPath } from './paths'
import type {
  FileSystemNode,
  NodeId,
  VfsResult,
  FileContent,
  DocumentRead,
  WriteOptions,
  WriteReceipt,
  RemoveOptions,
  VfsChangeScope,
  VfsChangeListener,
} from './types'

/** Each operation observes one committed tree, including the entire path traversal. */
export interface VfsReadRepository {
  readDocument(id: NodeId): Promise<VfsResult<DocumentRead>>
  getNode(id: NodeId): Promise<VfsResult<FileSystemNode>>
  getChildren(id: NodeId): Promise<VfsResult<readonly FileSystemNode[]>>
  resolvePath(path: ParsedPath, cwd: NodeId): Promise<VfsResult<NodeId>>
  pathOf(id: NodeId): Promise<VfsResult<string>>
}

export interface VfsRepository extends VfsReadRepository {
  subscribe(scope: VfsChangeScope, listener: VfsChangeListener): () => void
  remove(id: NodeId, options: RemoveOptions): Promise<VfsResult<void>>
  copyFile(
    id: NodeId,
    destination: NodeId,
    newName?: string,
  ): Promise<VfsResult<NodeId>>
  rename(id: NodeId, name: string): Promise<VfsResult<void>>
  move(
    id: NodeId,
    destination: NodeId,
    newName?: string,
  ): Promise<VfsResult<void>>
  writeFile(
    id: NodeId,
    content: FileContent,
    options: WriteOptions,
  ): Promise<VfsResult<WriteReceipt>>
  createDirectory(parentId: NodeId, name: string): Promise<VfsResult<NodeId>>
  createFile(
    parentId: NodeId,
    name: string,
    content: FileContent,
  ): Promise<VfsResult<NodeId>>
}
