import { ROOT_NODE_ID } from '../filesystem/policy'
import type { VfsRepository } from '../filesystem/repository'
import type {
  ContentId,
  VfsChange,
  VfsErrorCode,
  VfsResult,
  NodeId,
} from '../filesystem/types'
import { corrupt } from './records'
import { requestResult, transactionDone } from './requests'
import { INDEXES, STORES } from './schema'
import { readSubtree } from './subtree'
import { decodeTotals } from './totals'
import { createTransactionReader } from './transactionReader'
import type { DatabaseConnection } from './types'
function failure(
  code: VfsErrorCode,
  message: string,
  nodeId: NodeId,
): Extract<VfsResult<never>, { ok: false }> {
  return { ok: false, error: { code, message, nodeId } }
}
export function createIndexedDbRemove(
  connection: DatabaseConnection,
  options: { now: () => number; createOperationId: () => string },
  emit: (event: VfsChange) => void,
): VfsRepository['remove'] {
  return async (id, removeOptions) => {
    if (!removeOptions || typeof removeOptions.recursive !== 'boolean')
      return failure(
        'INVALID_REQUEST',
        'An explicit recursive option is required.',
        id,
      )
    let transaction: IDBTransaction | undefined,
      completion: Promise<unknown> | undefined
    try {
      transaction = connection.database.transaction(
        [STORES.nodes, STORES.contents, STORES.meta],
        'readwrite',
      )
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
      const query = createTransactionReader(tx),
        result = await query.get(id)
      if (!result.ok) return await reject(result)
      const node = result.value,
        chain = await query.ancestors(node)
      if (!chain.ok) return await reject(chain)
      if (
        node.parentId === null ||
        node.metadata.protected ||
        chain.value.some(
          (ancestor) =>
            ancestor.parentId === ROOT_NODE_ID && ancestor.name === 'system',
        )
      )
        return await reject(failure('PROTECTED', 'Node cannot be removed.', id))
      if (node.kind === 'directory' && !removeOptions.recursive) {
        const count = await requestResult(
          query.store.index(INDEXES.parent).count(id),
        )
        if (count)
          return await reject(
            failure('NOT_EMPTY', 'Directory is not empty.', id),
          )
      }
      const tree = await readSubtree(query.store, node)
      if (!tree.ok) return await reject(tree)
      const contentIds = new Set<ContentId>()
      let bytes = 0
      for (const current of tree.value) {
        if (current.metadata.protected)
          return await reject(
            failure(
              'PROTECTED',
              'Subtree contains a protected node.',
              current.id,
            ),
          )
        if (current.kind === 'file') {
          if (contentIds.has(current.contentId))
            return await reject(
              corrupt(
                'Subtree contains shared content identities.',
                current.id,
              ),
            )
          contentIds.add(current.contentId)
          bytes += current.byteLength
        }
      }
      const parent = chain.value[1]
      if (parent.metadataRevision >= Number.MAX_SAFE_INTEGER)
        return await reject(
          corrupt('Parent revision cannot advance.', parent.id),
        )
      const meta = tx.objectStore(STORES.meta),
        contents = tx.objectStore(STORES.contents)
      const [rawTotals, count, schema] = await Promise.all([
        requestResult<unknown>(meta.get('totals')),
        requestResult(query.store.count()),
        requestResult<unknown>(meta.get('schema')),
      ])
      const totals = decodeTotals(rawTotals, count, schema)
      if (!totals.ok) return await reject(totals)
      if (totals.value.textBytes < bytes || count - tree.value.length < 1)
        return await reject(corrupt('Removal would underflow counters.', id))
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
        metadataIds: Object.freeze([parent.id]),
        directoryIds: Object.freeze([parent.id]),
        removedIds: Object.freeze(tree.value.map((node) => node.id)),
        contentIds: Object.freeze([]),
        pathIds: Object.freeze([]),
      })
      // Queue native requests before creating promises, including possible sync failures.
      const deletes: IDBRequest<undefined>[] = []
      for (const current of tree.value)
        deletes.push(query.store.delete(current.id))
      for (const contentId of contentIds)
        deletes.push(contents.delete(contentId))
      const updates = [
        query.store.put({
          ...parent,
          metadataRevision: parent.metadataRevision + 1,
          updatedAt: now,
        }),
        meta.put({
          ...totals.value,
          nodeCount: count - tree.value.length,
          textBytes: totals.value.textBytes - bytes,
        }),
      ]
      await Promise.all([
        ...deletes.map(requestResult),
        ...updates.map(requestResult),
      ])
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
        'IndexedDB removal failed.',
        id,
      )
    }
  }
}
