import { INITIAL_DIRECTORIES, ROOT_NODE_ID } from './policy'
import type { DirectoryNode, NodeId } from './types'

/** Called once by a new memory adapter, never as a reload repair operation. */
export function createInitialNodes(
  now: number,
  createNodeId: () => NodeId,
): readonly DirectoryNode[] {
  const idsByPath = new Map<string, NodeId>()
  return INITIAL_DIRECTORIES.map(({ path, protected: protectedNode }) => {
    const root = path === '/'
    const slash = path.lastIndexOf('/')
    const parentPath = path.slice(0, slash) || '/'
    const id = root ? ROOT_NODE_ID : createNodeId()
    const parentId = root ? null : idsByPath.get(parentPath)
    if (parentId === undefined)
      throw new Error('Seed parent must precede its child')
    idsByPath.set(path, id)
    return {
      id,
      parentId,
      kind: 'directory',
      name: root ? '' : path.slice(slash + 1),
      createdAt: now,
      updatedAt: now,
      metadataRevision: 1,
      metadata: { protected: protectedNode },
    }
  })
}
