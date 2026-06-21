import type { VfsReadRepository } from '../filesystem/repository'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import type { FileSystemNode, NodeId, VfsResult } from '../filesystem/types'
import type { DatabaseConnection } from './types'
import { INDEXES, STORES } from './schema'
import { requestResult, transactionDone } from './requests'
import {
  corrupt,
  decodeContent,
  decodeNode,
  validateMetadataSnapshot,
} from './records'
function missing(id: NodeId): Extract<VfsResult<never>, { ok: false }> {
  return {
    ok: false,
    error: { code: 'NOT_FOUND', message: 'Node does not exist.', nodeId: id },
  }
}
function notDirectory(id: NodeId): Extract<VfsResult<never>, { ok: false }> {
  return {
    ok: false,
    error: {
      code: 'NOT_DIRECTORY',
      message: 'A directory is required.',
      nodeId: id,
    },
  }
}
/** Internal readonly boundary; callbacks await IDB requests only, never external tasks. */
async function read<T>(
  connection: DatabaseConnection,
  stores: string[],
  operation: (transaction: IDBTransaction) => Promise<VfsResult<T>>,
): Promise<VfsResult<T>> {
  let completion: Promise<boolean> | undefined
  try {
    const transaction = connection.database.transaction(stores, 'readonly')
    completion = transactionDone(transaction).then(
      () => true,
      () => false,
    )
    const result = await operation(transaction)
    if (!(await completion)) throw new Error('Read transaction aborted')
    return result
  } catch {
    await completion
    return {
      ok: false,
      error: {
        code: 'STORAGE_UNAVAILABLE',
        message: 'Could not read IndexedDB.',
      },
    }
  }
}
function reader(transaction: IDBTransaction) {
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
export function createIndexedDbReadRepository(
  connection: DatabaseConnection,
): VfsReadRepository {
  return {
    getNode: (id) =>
      read(connection, [STORES.nodes], async (transaction) => {
        const query = reader(transaction)
        const node = await query.get(id)
        if (!node.ok) return node
        const chain = await query.ancestors(node.value)
        return chain.ok ? node : chain
      }),
    getChildren: (id) =>
      read(connection, [STORES.nodes], async (transaction) => {
        const query = reader(transaction)
        const node = await query.get(id)
        if (!node.ok) return node
        if (node.value.kind !== 'directory') return notDirectory(id)
        const chain = await query.ancestors(node.value)
        if (!chain.ok) return chain
        const records = await requestResult<unknown[]>(
          query.store.index(INDEXES.parent).getAll(id, VFS_LIMITS.maxNodes + 1),
        )
        if (records.length > VFS_LIMITS.maxNodes)
          return corrupt('Directory exceeds node limit.', id)
        const names = new Set<string>(),
          ids = new Set<NodeId>()
        const children: FileSystemNode[] = []
        for (const raw of records) {
          const child = decodeNode(raw)
          if (!child.ok) return child
          if (
            child.value.parentId !== id ||
            names.has(child.value.name) ||
            ids.has(child.value.id)
          )
            return corrupt('Directory listing is inconsistent.', id)
          names.add(child.value.name)
          ids.add(child.value.id)
          children.push(child.value)
        }
        children.sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )
        return { ok: true, value: Object.freeze(children) }
      }),
    pathOf: (id) =>
      read(connection, [STORES.nodes], async (transaction) => {
        const query = reader(transaction)
        const node = await query.get(id)
        if (!node.ok) return node
        const chain = await query.ancestors(node.value)
        if (!chain.ok) return chain
        return {
          ok: true,
          value:
            '/' +
            chain.value
              .slice(0, -1)
              .map((node) => node.name)
              .reverse()
              .join('/'),
        }
      }),
    resolvePath: (path, cwd) =>
      read(connection, [STORES.nodes], async (transaction) => {
        const query = reader(transaction)
        let result = await query.get(
          path.kind === 'absolute' ? ROOT_NODE_ID : cwd,
        )
        if (!result.ok) return result
        if (result.value.kind !== 'directory')
          return notDirectory(result.value.id)
        const ancestry = await query.ancestors(result.value)
        if (!ancestry.ok) return ancestry
        for (const segment of path.segments) {
          if (result.value.kind !== 'directory')
            return notDirectory(result.value.id)
          if (segment.kind === 'current') continue
          if (segment.kind === 'parent')
            result = await query.get(result.value.parentId ?? ROOT_NODE_ID)
          else {
            const raw = await requestResult<unknown>(
              query.store
                .index(INDEXES.sibling)
                .get([result.value.id, segment.name]),
            )
            if (raw === undefined) return missing(result.value.id)
            const decoded = decodeNode(raw)
            if (!decoded.ok) return decoded
            if (
              decoded.value.parentId !== result.value.id ||
              decoded.value.name !== segment.name
            )
              return corrupt('Path index is inconsistent.', result.value.id)
            result = decoded
          }
          if (!result.ok) return result
        }
        if (path.requiresDirectory && result.value.kind !== 'directory')
          return notDirectory(result.value.id)
        return { ok: true, value: result.value.id }
      }),
    readDocument: (id) =>
      read(connection, [STORES.nodes, STORES.contents], async (transaction) => {
        const query = reader(transaction)
        const result = await query.get(id)
        if (!result.ok) return result
        if (result.value.kind !== 'file')
          return {
            ok: false,
            error: {
              code: 'NOT_FILE',
              message: 'Node is not a file.',
              nodeId: id,
            },
          }
        const chain = await query.ancestors(result.value)
        if (!chain.ok) return chain
        const node = result.value
        const raw = await requestResult<unknown>(
          transaction.objectStore(STORES.contents).get(node.contentId),
        )
        const content = decodeContent(raw, node)
        if (!content.ok) return content
        return {
          ok: true,
          value: Object.freeze({
            node,
            content: content.value,
            contentRevision: node.contentRevision,
          }),
        }
      }),
  }
}
export function validateStoredMetadata(
  connection: DatabaseConnection,
): Promise<VfsResult<void>> {
  return read(connection, [STORES.nodes, STORES.meta], async (transaction) => {
    const meta = transaction.objectStore(STORES.meta)
    const [nodes, schema, totals] = await Promise.all([
      requestResult<unknown[]>(
        transaction
          .objectStore(STORES.nodes)
          .getAll(undefined, VFS_LIMITS.maxNodes + 1),
      ),
      requestResult<unknown>(meta.get('schema')),
      requestResult<unknown>(meta.get('totals')),
    ])
    return validateMetadataSnapshot(nodes, schema, totals)
  })
}
