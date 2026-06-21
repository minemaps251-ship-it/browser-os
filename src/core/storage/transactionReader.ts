import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import type { FileSystemNode, NodeId, VfsResult } from '../filesystem/types'
import { STORES } from './schema'
import { requestResult } from './requests'
import { corrupt, decodeNode } from './records'
function missing(id: NodeId): Extract<VfsResult<never>, { ok: false }> {
  return {
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Node does not exist.', nodeId: id },
  }
}
export function createTransactionReader(transaction: IDBTransaction) {
  const store = transaction.objectStore(STORES.nodes)
  const cache = new Map<NodeId, FileSystemNode>() // Only this transaction, no shared cache.
  async function get(id: NodeId): Promise<VfsResult<FileSystemNode>> {
    const cached = cache.get(id)
    if (cached) return { ok: true, value: cached }
    const raw = await requestResult<unknown>(store.get(id))
    if (raw === undefined)
      return id === ROOT_NODE_ID
        ? corrupt('Filesystem root is missing.', id)
        : missing(id)
    const result = decodeNode(raw, id)
    if (result.ok) cache.set(id, result.value)
    return result
  }
  async function ancestors(
    node: FileSystemNode,
  ): Promise<VfsResult<readonly FileSystemNode[]>> {
    const chain: FileSystemNode[] = []
    const seen = new Set<NodeId>()
    let current = node
    while (true) {
      if (seen.has(current.id) || seen.size >= VFS_LIMITS.maxNodes)
        return corrupt('Parent cycle or depth limit exceeded.', node.id)
      seen.add(current.id)
      chain.push(current)
      if (current.id === ROOT_NODE_ID) return { ok: true, value: chain }
      const parent = await get(current.parentId!)
      if (!parent.ok)
        return parent.error.code === 'NOT_FOUND'
          ? corrupt('Parent directory is missing.', current.id)
          : parent
      if (parent.value.kind !== 'directory')
        return corrupt('Parent is not a directory.', current.id)
      current = parent.value
    }
  }
  return { store, get, ancestors }
}
