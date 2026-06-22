import { prepareTextContent } from '../filesystem/content'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import type { VfsRepository } from '../filesystem/repository'
import type {
  VfsChange,
  VfsResult,
  VfsErrorCode,
  WriteReceipt,
} from '../filesystem/types'
import { corrupt, decodeContent } from './records'
import { requestResult, transactionDone } from './requests'
import { STORES } from './schema'
import { decodeTotals } from './totals'
import { createTransactionReader } from './transactionReader'
import type { DatabaseConnection } from './types'

function failure(
  code: VfsErrorCode,
  message: string,
): Extract<VfsResult<never>, { ok: false }> {
  return { ok: false, error: { code, message } }
}
/** Shared dispatcher is owned by the repository; this module only performs saves. */
export function createIndexedDbWriteFile(
  connection: DatabaseConnection,
  options: { now: () => number; createOperationId: () => string },
  emit: (event: VfsChange) => void,
): VfsRepository['writeFile'] {
  return async (
    id,
    content,
    writeOptions,
  ): Promise<VfsResult<WriteReceipt>> => {
    let transaction: IDBTransaction | undefined
    let completion: Promise<unknown> | undefined
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
      const query = createTransactionReader(tx)
      const result = await query.get(id)
      if (!result.ok) return await reject(result)
      const node = result.value
      if (node.kind !== 'file')
        return await reject(failure('NOT_FILE', 'Node is not a file.'))
      const ancestry = await query.ancestors(node)
      if (!ancestry.ok) return await reject(ancestry)
      if (
        node.metadata.protected ||
        ancestry.value.some(
          (ancestor) =>
            ancestor.parentId === ROOT_NODE_ID && ancestor.name === 'system',
        )
      )
        return await reject(failure('PROTECTED', 'File is read-only.'))
      if (
        !writeOptions ||
        !Number.isSafeInteger(writeOptions.expectedContentRevision) ||
        writeOptions.expectedContentRevision < 1 ||
        typeof writeOptions.requestId !== 'string' ||
        !writeOptions.requestId.trim()
      )
        return await reject(
          failure(
            'INVALID_REQUEST',
            'A positive expected revision and non-empty request ID are required.',
          ),
        )
      if (node.contentRevision !== writeOptions.expectedContentRevision)
        return await reject({
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'File changed since it was read.',
            nodeId: id,
            expectedRevision: writeOptions.expectedContentRevision,
            actualRevision: node.contentRevision,
          },
        })
      if (
        node.contentRevision >= Number.MAX_SAFE_INTEGER ||
        node.metadataRevision >= Number.MAX_SAFE_INTEGER
      )
        return await reject(corrupt('File revision cannot advance.', id))
      const prepared = prepareTextContent(content)
      if (!prepared.ok) return await reject(prepared)
      if (prepared.value.byteLength > VFS_LIMITS.maxFileBytes)
        return await reject(failure('TOO_LARGE', 'File size limit exceeded.'))
      const contents = tx.objectStore(STORES.contents),
        meta = tx.objectStore(STORES.meta)
      const [rawContent, rawTotals, count, schema] = await Promise.all([
        requestResult<unknown>(contents.get(node.contentId)),
        requestResult<unknown>(meta.get('totals')),
        requestResult(query.store.count()),
        requestResult<unknown>(meta.get('schema')),
      ])
      const oldContent = decodeContent(rawContent, node)
      if (!oldContent.ok) return await reject(oldContent)
      const totals = decodeTotals(rawTotals, count, schema)
      if (!totals.ok) return await reject(totals)
      if (totals.value.textBytes < node.byteLength)
        return await reject(
          corrupt('Total byte counter is smaller than file size.', id),
        )
      const textBytes =
        totals.value.textBytes - node.byteLength + prepared.value.byteLength
      if (textBytes > VFS_LIMITS.maxTotalBytes)
        return await reject(
          failure('TOO_LARGE', 'Total text size limit exceeded.'),
        )
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
      const next = {
        ...node,
        byteLength: prepared.value.byteLength,
        updatedAt: now,
        metadataRevision: node.metadataRevision + 1,
        contentRevision: node.contentRevision + 1,
      }
      const receipt = Object.freeze({
        contentRevision: next.contentRevision,
        operationId,
        originRequestId: writeOptions.requestId,
      })
      const event: VfsChange = Object.freeze({
        operationId,
        originRequestId: writeOptions.requestId,
        metadataIds: Object.freeze([id]),
        contentIds: Object.freeze([id]),
        directoryIds: Object.freeze([node.parentId]),
        pathIds: Object.freeze([]),
        removedIds: Object.freeze([]),
      })
      // No Promise is created until every synchronous request has been queued.
      const writes = [
        query.store.put(next),
        contents.put({ id: node.contentId, content: prepared.value.content }),
        meta.put({ ...totals.value, textBytes }),
      ]
      await Promise.all(writes.map(requestResult))
      const error = await completion
      if (error) throw error
      emit(event)
      return { ok: true, value: receipt }
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
        'IndexedDB save transaction failed.',
      )
    }
  }
}
