import { VFS_LIMITS } from '../filesystem/policy'
import type { FileSystemNode, NodeId, VfsResult } from '../filesystem/types'
import { corrupt, decodeNode } from './records'
import { requestResult } from './requests'
import { INDEXES } from './schema'
/** Transaction-local indexed metadata traversal, with node and corruption guards. */
export async function readSubtree(
  store: IDBObjectStore,
  node: FileSystemNode,
): Promise<VfsResult<readonly FileSystemNode[]>> {
  const nodes: FileSystemNode[] = [],
    seen = new Set<NodeId>(),
    pending = [node]
  while (pending.length) {
    const current = pending.pop()!
    if (seen.has(current.id) || seen.size >= VFS_LIMITS.maxNodes)
      return corrupt('Subtree cycle or node limit exceeded.', node.id)
    seen.add(current.id)
    nodes.push(current)
    if (current.kind === 'file') continue
    const records = await requestResult<unknown[]>(
      store.index(INDEXES.parent).getAll(current.id, VFS_LIMITS.maxNodes + 1),
    )
    if (records.length + seen.size + pending.length > VFS_LIMITS.maxNodes)
      return corrupt('Subtree exceeds node limit.', node.id)
    const names = new Set<string>()
    for (const raw of records) {
      const child = decodeNode(raw)
      if (!child.ok) return child
      if (child.value.parentId !== current.id || names.has(child.value.name))
        return corrupt('Subtree listing is inconsistent.', current.id)
      names.add(child.value.name)
      pending.push(child.value)
    }
  }
  return { ok: true, value: nodes }
}
