import { createIndexedDbRelocation } from './relocate'
import { createIndexedDbWriteFile } from './writeFile'
import type { VfsReadRepository, VfsRepository } from '../filesystem/repository'
import type {
  ContentId,
  FileContent,
  FileSystemNode,
  NodeId,
  VfsChange,
  VfsErrorCode,
  VfsResult,
} from '../filesystem/types'
import { normalizeName } from '../filesystem/names'
import { prepareTextContent } from '../filesystem/content'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import { createVfsChangeDispatcher } from '../filesystem/changes'
import { createIndexedDbReadRepository } from './readRepository'
import { createTransactionReader } from './transactionReader'
import { corrupt } from './records'
import { decodeTotals } from './totals'
import { INDEXES, STORES } from './schema'
import { requestResult, transactionDone } from './requests'
import type { DatabaseConnection } from './types'

export type VfsCreateRepository = VfsReadRepository &
  Pick<
    VfsRepository,
    | 'createDirectory'
    | 'createFile'
    | 'writeFile'
    | 'rename'
    | 'move'
    | 'subscribe'
  >
interface CreateOptions {
  now: () => number
  createNodeId: () => NodeId
  createContentId: () => ContentId
  createOperationId: () => string
  onListenerError?: (error: unknown) => void
}
function failure(
  code: VfsErrorCode,
  message: string,
): Extract<VfsResult<never>, { ok: false }> {
  return { ok: false, error: { code, message } }
}
/** Call validateStoredMetadata before enabling a writable runtime. No cross-connection event bus. */
export function createIndexedDbCreateRepository(
  connection: DatabaseConnection,
  options: CreateOptions,
): VfsCreateRepository {
  const changes = createVfsChangeDispatcher(options.onListenerError)
  async function create(
    parentId: NodeId,
    name: string,
    content?: FileContent,
  ): Promise<VfsResult<NodeId>> {
    const normalized = normalizeName(name)
    const prepared =
      content === undefined ? undefined : prepareTextContent(content)
    const text = prepared?.ok ? prepared.value : undefined
    const bytes = text?.byteLength ?? 0
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
      const parent = await query.get(parentId)
      if (!parent.ok) return await reject(parent)
      if (parent.value.kind !== 'directory')
        return await reject(
          failure('NOT_DIRECTORY', 'Parent is not a directory.'),
        )
      const ancestry = await query.ancestors(parent.value)
      if (!ancestry.ok) return await reject(ancestry)
      if (
        ancestry.value.some(
          (node) => node.parentId === ROOT_NODE_ID && node.name === 'system',
        )
      )
        return await reject(
          failure('PROTECTED', 'System subtree is read-only.'),
        )
      if (!normalized.ok) return await reject(normalized)
      const meta = tx.objectStore(STORES.meta),
        contents = tx.objectStore(STORES.contents)
      const [sibling, rawTotals, count, schema] = await Promise.all([
        requestResult<unknown>(
          query.store.index(INDEXES.sibling).get([parentId, normalized.value]),
        ),
        requestResult<unknown>(meta.get('totals')),
        requestResult(query.store.count()),
        requestResult<unknown>(meta.get('schema')),
      ])
      if (sibling !== undefined)
        return await reject(
          failure('ALREADY_EXISTS', 'A sibling already exists.'),
        )
      const totals = decodeTotals(rawTotals, count, schema)
      if (!totals.ok) return await reject(totals)
      if (count >= VFS_LIMITS.maxNodes)
        return await reject(failure('TOO_LARGE', 'Node count limit reached.'))
      if (prepared && !prepared.ok) return await reject(prepared)
      if (
        bytes > VFS_LIMITS.maxFileBytes ||
        totals.value.textBytes + bytes > VFS_LIMITS.maxTotalBytes
      )
        return await reject(failure('TOO_LARGE', 'Filesystem limit exceeded.'))
      if (parent.value.metadataRevision >= Number.MAX_SAFE_INTEGER)
        return await reject(
          corrupt('Parent revision cannot advance.', parentId),
        )
      const id = options.createNodeId(),
        contentId = text ? options.createContentId() : undefined
      const now = options.now(),
        operationId = options.createOperationId()
      if (
        !id ||
        !Number.isFinite(now) ||
        !operationId?.trim() ||
        (text && !contentId)
      )
        return await reject(
          corrupt('Generated identity or timestamp is invalid.'),
        )
      const [existingNode, existingContent] = await Promise.all([
        requestResult<unknown>(query.store.get(id)),
        contentId
          ? requestResult<unknown>(contents.get(contentId))
          : Promise.resolve(undefined),
      ])
      if (existingNode !== undefined || existingContent !== undefined)
        return await reject(corrupt('Generated identity already exists.'))
      const base = {
        id,
        parentId,
        name: normalized.value,
        createdAt: now,
        updatedAt: now,
        metadataRevision: 1,
        metadata: { protected: false },
      }
      const node: FileSystemNode =
        text && contentId
          ? {
              ...base,
              kind: 'file',
              contentId,
              contentRevision: 1,
              byteLength: bytes,
              mime: 'text/plain',
            }
          : { ...base, kind: 'directory' }
      const event: VfsChange = Object.freeze({
        operationId,
        originRequestId: operationId,
        metadataIds: Object.freeze([id, parentId]),
        contentIds: Object.freeze(text ? [id] : []),
        pathIds: Object.freeze([id]),
        directoryIds: Object.freeze([parentId]),
        removedIds: Object.freeze([]),
      })
      // Queue native requests first: a synchronous add/put failure must not leave
      // request promises without rejection handlers during transaction rollback.
      const writes: IDBRequest<IDBValidKey>[] = [
        query.store.add(node),
        query.store.put({
          ...parent.value,
          metadataRevision: parent.value.metadataRevision + 1,
          updatedAt: now,
        }),
        meta.put({
          key: 'totals',
          nodeCount: count + 1,
          textBytes: totals.value.textBytes + bytes,
        }),
      ]
      if (text && contentId)
        writes.push(contents.add({ id: contentId, content: text.content }))
      await Promise.all(writes.map(requestResult))
      const error = await completion
      if (error) throw error
      changes.emit(event)
      return { ok: true, value: id }
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
        'IndexedDB create transaction failed.',
      )
    }
  }
  return {
    ...createIndexedDbReadRepository(connection),
    subscribe: changes.subscribe,
    ...createIndexedDbRelocation(connection, options, changes.emit),
    writeFile: createIndexedDbWriteFile(connection, options, changes.emit),
    createDirectory: (parent, name) => create(parent, name),
    createFile: (parent, name, content) =>
      content
        ? create(parent, name, content)
        : Promise.resolve(
            failure('INVALID_CONTENT', 'File content is required.'),
          ),
  }
}
