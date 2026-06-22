import { normalizeName } from '../filesystem/names'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import type { VfsRepository } from '../filesystem/repository'
import type {
  FileSystemNode,
  NodeId,
  VfsChange,
  VfsErrorCode,
  VfsResult,
} from '../filesystem/types'
import { corrupt, decodeNode } from './records'
import { requestResult, transactionDone } from './requests'
import { INDEXES, STORES } from './schema'
import { createTransactionReader } from './transactionReader'
import type { DatabaseConnection } from './types'
function failure(
  code: VfsErrorCode,
  message: string,
  nodeId: NodeId,
): Extract<VfsResult<never>, { ok: false }> {
  return { ok: false, error: { code, message, nodeId } }
}
function inSystem(chain: readonly FileSystemNode[]) {
  return chain.some(
    (node) => node.parentId === ROOT_NODE_ID && node.name === 'system',
  )
}
/** Indexed, bounded metadata traversal; descendants are invalidated, never rewritten. */
async function subtree(
  store: IDBObjectStore,
  node: FileSystemNode,
): Promise<VfsResult<readonly NodeId[]>> {
  const ids: NodeId[] = [],
    seen = new Set<NodeId>(),
    pending = [node]
  while (pending.length) {
    const current = pending.pop()!
    if (seen.has(current.id) || seen.size >= VFS_LIMITS.maxNodes)
      return corrupt('Subtree cycle or node limit exceeded.', node.id)
    seen.add(current.id)
    ids.push(current.id)
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
  return { ok: true, value: ids }
}
export function createIndexedDbRelocation(
  connection: DatabaseConnection,
  options: { now: () => number; createOperationId: () => string },
  emit: (event: VfsChange) => void,
): Pick<VfsRepository, 'rename' | 'move'> {
  async function relocate(
    id: NodeId,
    destination?: NodeId,
    newName?: string,
  ): Promise<VfsResult<void>> {
    let transaction: IDBTransaction | undefined,
      completion: Promise<unknown> | undefined
    try {
      transaction = connection.database.transaction(STORES.nodes, 'readwrite')
      completion = transactionDone(transaction).then(
        () => undefined,
        (error: unknown) => error ?? new Error('Transaction aborted'),
      )
      const tx = transaction
      async function reject(result: Extract<VfsResult<never>, { ok: false }>) {
        tx.abort()
        await completion
        return result
      }
      const query = createTransactionReader(tx)
      const source = await query.get(id)
      if (!source.ok) return await reject(source)
      const node = source.value
      const sourceChain = await query.ancestors(node)
      if (!sourceChain.ok) return await reject(sourceChain)
      if (
        node.parentId === null ||
        node.metadata.protected ||
        inSystem(sourceChain.value)
      )
        return await reject(
          failure('PROTECTED', 'Node cannot be renamed or moved.', id),
        )
      const parentId = destination ?? node.parentId
      const parent = await query.get(parentId)
      if (!parent.ok) return await reject(parent)
      if (parent.value.kind !== 'directory')
        return await reject(
          failure('NOT_DIRECTORY', 'Destination is not a directory.', parentId),
        )
      const destinationChain = await query.ancestors(parent.value)
      if (!destinationChain.ok) return await reject(destinationChain)
      if (inSystem(destinationChain.value))
        return await reject(
          failure('PROTECTED', 'System subtree is read-only.', parentId),
        )
      const normalized = normalizeName(newName ?? node.name)
      if (!normalized.ok) return await reject(normalized)
      if (
        node.kind === 'directory' &&
        destinationChain.value.some((ancestor) => ancestor.id === id)
      )
        return await reject(
          failure('CYCLE', 'Directory cannot move inside itself.', id),
        )
      const rawSibling = await requestResult<unknown>(
        query.store.index(INDEXES.sibling).get([parentId, normalized.value]),
      )
      if (rawSibling !== undefined) {
        const sibling = decodeNode(rawSibling)
        if (!sibling.ok) return await reject(sibling)
        if (sibling.value.id !== id)
          return await reject(
            failure(
              'ALREADY_EXISTS',
              'Destination already contains that name.',
              parentId,
            ),
          )
      }
      if (parentId === node.parentId && normalized.value === node.name) {
        const error = await completion
        if (error) throw error
        return { ok: true, value: undefined }
      }
      // Source ancestry already validates the previous parent in this same snapshot.
      const oldParent = sourceChain.value[1]
      const parents =
        parentId === node.parentId ? [parent.value] : [oldParent, parent.value]
      if (
        [node, ...parents].some(
          (affected) => affected.metadataRevision >= Number.MAX_SAFE_INTEGER,
        )
      )
        return await reject(corrupt('Metadata revision cannot advance.', id))
      const paths = await subtree(query.store, node)
      if (!paths.ok) return await reject(paths)
      const now = options.now(),
        operationId = options.createOperationId()
      if (
        !Number.isFinite(now) ||
        typeof operationId !== 'string' ||
        !operationId.trim()
      )
        return await reject(
          corrupt('Operation identity or timestamp is invalid.', id),
        )
      const event: VfsChange = Object.freeze({
        operationId,
        originRequestId: operationId,
        metadataIds: Object.freeze([id, ...parents.map((parent) => parent.id)]),
        pathIds: Object.freeze([...paths.value]),
        directoryIds: Object.freeze(parents.map((parent) => parent.id)),
        contentIds: Object.freeze([]),
        removedIds: Object.freeze([]),
      })
      const writes = [
        query.store.put({
          ...node,
          parentId,
          name: normalized.value,
          metadataRevision: node.metadataRevision + 1,
          updatedAt: now,
        }),
        ...parents.map((parent) =>
          query.store.put({
            ...parent,
            metadataRevision: parent.metadataRevision + 1,
            updatedAt: now,
          }),
        ),
      ]
      await Promise.all(writes.map(requestResult))
      const error = await completion
      if (error) throw error
      emit(event)
      return { ok: true, value: undefined }
    } catch (error) {
      try {
        transaction?.abort()
      } catch {
        /* Already completed or aborted. */
      }
      const abortError = await completion
      const quota = [error, abortError].some(
        (value) =>
          value instanceof DOMException && value.name === 'QuotaExceededError',
      )
      return failure(
        quota ? 'QUOTA' : 'STORAGE_UNAVAILABLE',
        'IndexedDB relocation failed.',
        id,
      )
    }
  }
  return {
    rename: (id, name) => relocate(id, undefined, name),
    move: (id, destination, newName) => relocate(id, destination, newName),
  }
}
