import type { ParsedPath } from './paths'
import type {
  FileSystemNode,
  NodeId,
  VfsResult,
  FileContent,
  DocumentRead,
  WriteOptions,
  WriteReceipt,
} from './types'

/** Each operation observes one committed tree, including the entire path traversal. */
export interface VfsReadRepository {
  getNode(id: NodeId): Promise<VfsResult<FileSystemNode>>
  getChildren(id: NodeId): Promise<VfsResult<readonly FileSystemNode[]>>
  resolvePath(path: ParsedPath, cwd: NodeId): Promise<VfsResult<NodeId>>
  pathOf(id: NodeId): Promise<VfsResult<string>>
}

export interface VfsRepository extends VfsReadRepository {
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
  readDocument(id: NodeId): Promise<VfsResult<DocumentRead>>
  createDirectory(parentId: NodeId, name: string): Promise<VfsResult<NodeId>>
  createFile(
    parentId: NodeId,
    name: string,
    content: FileContent,
  ): Promise<VfsResult<NodeId>>
}
