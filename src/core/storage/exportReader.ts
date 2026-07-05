import { VFS_LIMITS } from '../filesystem/policy'
import type { FileSystemNode, StoredFileContent } from '../filesystem/types'
import { decodeTheme } from '../settings/types'
import { exportFailure, type ExportReader } from '../export/types'
import { decodeNode, decodeContent, validateMetadataSnapshot } from './records'
import { requestResult, transactionDone } from './requests'
import { STORES } from './schema'
import type { DatabaseConnection } from './types'
/** All stores share one readonly transaction; no writes, traversal refetch or UI state. */
export function createIndexedDbExportReader(
  connection: DatabaseConnection,
): ExportReader {
  return async () => {
    let completion: Promise<boolean> | undefined
    try {
      if (connection.closed)
        return exportFailure(
          'UNAVAILABLE',
          'Browser storage has been closed. Reload the workspace before exporting.',
        )
      const transaction = connection.database.transaction(
        Object.values(STORES),
        'readonly',
      )
      completion = transactionDone(transaction).then(
        () => true,
        () => false,
      )
      const meta = transaction.objectStore(STORES.meta)
      const [rawNodes, rawContents, schema, totals, rawTheme] =
        await Promise.all([
          requestResult<unknown[]>(
            transaction
              .objectStore(STORES.nodes)
              .getAll(undefined, VFS_LIMITS.maxNodes + 1),
          ),
          requestResult<unknown[]>(
            transaction
              .objectStore(STORES.contents)
              .getAll(undefined, VFS_LIMITS.maxNodes + 1),
          ),
          requestResult<unknown>(meta.get('schema')),
          requestResult<unknown>(meta.get('totals')),
          requestResult<unknown>(
            transaction.objectStore(STORES.settings).get('theme'),
          ),
        ])
      if (!(await completion))
        return exportFailure(
          'UNAVAILABLE',
          'The export read was interrupted. Please retry.',
        )
      const valid = validateMetadataSnapshot(rawNodes, schema, totals)
      const theme = decodeTheme(rawTheme)
      if (!valid.ok || !theme.ok || rawContents.length > VFS_LIMITS.maxNodes)
        return exportFailure(
          'INVALID_DATA',
          'Stored workspace data is inconsistent. Export was not prepared.',
        )
      const contents = new Map<string, unknown>()
      for (const raw of rawContents) {
        if (
          !raw ||
          typeof raw !== 'object' ||
          !('id' in raw) ||
          typeof raw.id !== 'string' ||
          contents.has(raw.id)
        )
          return exportFailure(
            'INVALID_DATA',
            'Stored file references are inconsistent.',
          )
        contents.set(raw.id, raw)
      }
      const nodes: FileSystemNode[] = [],
        records: StoredFileContent[] = []
      for (const raw of rawNodes) {
        const node = decodeNode(raw)
        if (!node.ok)
          return exportFailure(
            'INVALID_DATA',
            'Stored file metadata is inconsistent.',
          )
        nodes.push(node.value)
        if (node.value.kind === 'file') {
          const content = decodeContent(
            contents.get(node.value.contentId),
            node.value,
          )
          if (!content.ok)
            return exportFailure(
              'INVALID_DATA',
              'Stored file text is inconsistent. Export was not prepared.',
            )
          records.push({ id: node.value.contentId, content: content.value })
        }
      }
      if (records.length !== contents.size)
        return exportFailure(
          'INVALID_DATA',
          'Stored file references are inconsistent.',
        )
      return {
        ok: true,
        value: Object.freeze({
          nodes: Object.freeze(nodes),
          contents: Object.freeze(
            records.map((record) => Object.freeze(record)),
          ),
          theme: theme.value,
        }),
      }
    } catch {
      await completion
      return exportFailure(
        'UNAVAILABLE',
        'Browser storage could not be read. Retry the export.',
      )
    }
  }
}
