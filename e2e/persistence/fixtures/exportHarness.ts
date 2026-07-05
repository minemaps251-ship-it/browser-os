import { open, repo, text, value } from './createHarness'
import { createIndexedDbExportReader } from '../../../src/core/storage/exportReader'
import { createWorkspaceExportService } from '../../../src/core/export/service'
import { STORES } from '../../../src/core/storage/schema'
import {
  requestResult,
  transactionDone,
} from '../../../src/core/storage/requests'
import { ROOT_NODE_ID } from '../../../src/core/filesystem/policy'
import type { DatabaseConnection } from '../../../src/core/storage/types'
import type { VfsChange } from '../../../src/core/filesystem/types'
async function stored(connection: DatabaseConnection) {
  const tx = connection.database.transaction(Object.values(STORES), 'readonly')
  const done = transactionDone(tx)
  const records = await Promise.all(
    Object.values(STORES).map((store) =>
      requestResult<unknown[]>(tx.objectStore(store).getAll()),
    ),
  )
  await done
  return JSON.stringify(records)
}
const api = {
  async consistent(name: string) {
    const connection = await open(name),
      writer = await open(name)
    try {
      const repository = repo(connection)
      const fileId = value(
        await repository.createFile(ROOT_NODE_ID, 'source.txt', text('before')),
      )
      const original = value(await repository.readDocument(fileId))
      const events: VfsChange[] = []
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const first = createIndexedDbExportReader(connection)()
      // One concurrent all-store commit waits for the existing read snapshot.
      const tx = writer.database.transaction(Object.values(STORES), 'readwrite')
      const done = transactionDone(tx)
      tx.objectStore(STORES.nodes).put({
        ...original.node,
        contentRevision: original.contentRevision + 1,
        metadataRevision: original.node.metadataRevision + 1,
      })
      tx.objectStore(STORES.contents).put({
        id: original.node.contentId,
        content: text('after!'),
      })
      tx.objectStore(STORES.settings).put({
        key: 'theme',
        value: 'dark',
        schemaVersion: 1,
      })
      const before = await first
      await done
      const saved = await stored(connection)
      const scopes: { stores: string[]; mode?: IDBTransactionMode }[] = []
      const transaction = connection.database.transaction.bind(
        connection.database,
      )
      connection.database.transaction = (
        ...args: Parameters<IDBDatabase['transaction']>
      ) => {
        const tx = transaction(...args)
        scopes.push({ stores: [...tx.objectStoreNames], mode: args[1] })
        return tx
      }
      const service = createWorkspaceExportService(
        createIndexedDbExportReader(connection),
        'persistent',
        () => 1000,
      )
      const after = await service.prepare()
      connection.database.transaction = transaction
      return {
        before,
        immutable:
          before.ok &&
          Object.isFrozen(before.value.nodes) &&
          Object.isFrozen(before.value.contents) &&
          before.value.contents.every(
            (record) =>
              Object.isFrozen(record) && Object.isFrozen(record.content),
          ),
        after,
        scopes,
        events,
        unchanged: saved === (await stored(connection)),
      }
    } finally {
      connection.close()
      writer.close()
    }
  },
  async failure(
    name: string,
    mode:
      | 'orphan'
      | 'missing'
      | 'wrong-size'
      | 'theme'
      | 'totals'
      | 'abort'
      | 'closed',
  ) {
    const connection = await open(name)
    const transaction = connection.database.transaction.bind(
      connection.database,
    )
    try {
      const repository = repo(connection)
      const fileId = value(
        await repository.createFile(ROOT_NODE_ID, 'saved.txt', text('saved')),
      )
      const file = value(await repository.readDocument(fileId))
      if (!['abort', 'closed'].includes(mode)) {
        const tx = transaction(Object.values(STORES), 'readwrite')
        const done = transactionDone(tx)
        if (mode === 'orphan')
          tx.objectStore(STORES.contents).put({
            id: 'orphan',
            content: text('x'),
          })
        if (mode === 'missing')
          tx.objectStore(STORES.contents).delete(file.node.contentId)
        if (mode === 'wrong-size')
          tx.objectStore(STORES.contents).put({
            id: file.node.contentId,
            content: text('different length'),
          })
        if (mode === 'theme')
          tx.objectStore(STORES.settings).put({
            key: 'theme',
            value: 'bad-theme',
            schemaVersion: 1,
          })
        if (mode === 'totals')
          tx.objectStore(STORES.meta).put({
            key: 'totals',
            nodeCount: 99,
            textBytes: 5,
          })
        await done
      }
      const before = await stored(connection)
      if (mode === 'closed') connection.close()
      if (mode === 'abort')
        connection.database.transaction = (
          ...args: Parameters<IDBDatabase['transaction']>
        ) => {
          const tx = transaction(...args)
          const store = tx.objectStore(STORES.nodes),
            getAll = store.getAll.bind(store)
          store.getAll = (...args: Parameters<IDBObjectStore['getAll']>) => {
            const request = getAll(...args)
            request.addEventListener('success', () => tx.abort(), {
              once: true,
            })
            return request
          }
          return tx
        }
      const result = await createWorkspaceExportService(
        createIndexedDbExportReader(connection),
        'persistent',
      ).prepare()
      connection.database.transaction = transaction
      const observer = mode === 'closed' ? await open(name) : connection
      try {
        return { result, unchanged: before === (await stored(observer)) }
      } finally {
        if (observer !== connection) observer.close()
      }
    } finally {
      connection.database.transaction = transaction
      connection.close()
    }
  },
}
declare global {
  interface Window {
    idbExport: typeof api
  }
}
window.idbExport = api
