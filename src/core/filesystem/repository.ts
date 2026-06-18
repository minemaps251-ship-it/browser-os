import type { ParsedPath } from './paths'
import type { FileSystemNode, NodeId, VfsResult } from './types'

/** Each operation observes one committed tree, including the entire path traversal. */
export interface VfsReadRepository {
  getNode(id: NodeId): Promise<VfsResult<FileSystemNode>>
  getChildren(id: NodeId): Promise<VfsResult<readonly FileSystemNode[]>>
  resolvePath(path: ParsedPath, cwd: NodeId): Promise<VfsResult<NodeId>>
  pathOf(id: NodeId): Promise<VfsResult<string>>
}
