import { open, repo, snapshot, text, value } from './createHarness'
import { STORES } from '../../../src/core/storage/schema'
import { ROOT_NODE_ID } from '../../../src/core/filesystem/policy'
import type { VfsChange } from '../../../src/core/filesystem/types'
const api = {
  async failure(name: string, mode: 'abort' | 'quota' | 'closed') {
    const connection = await open(name)
    const original = connection.database.transaction.bind(connection.database)
    try {
      const repository = repo(connection)
      const id = value(
        await repository.createFile(ROOT_NODE_ID, 'kept.txt', text('Keep me')),
      )
      const before = await snapshot(connection)
      const events: VfsChange[] = []
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      if (mode === 'closed') connection.close()
      else
        connection.database.transaction = (
          ...args: Parameters<IDBDatabase['transaction']>
        ) => {
          const tx = original(...args)
          if (args[1] === 'readwrite') {
            const store = tx.objectStore(STORES.nodes)
            const put = store.put.bind(store)
            store.put = (...values: Parameters<IDBObjectStore['put']>) => {
              if (mode === 'quota')
                throw new DOMException('Injected quota', 'QuotaExceededError')
              const request = put(...values)
              request.addEventListener('success', () => tx.abort())
              return request
            }
          }
          return tx
        }
      const result = await repository.touchFile(ROOT_NODE_ID, 'kept.txt')
      connection.database.transaction = original
      const observer = mode === 'closed' ? await open(name) : connection
      try {
        return {
          result,
          events,
          unchanged:
            JSON.stringify(before) === JSON.stringify(await snapshot(observer)),
          id,
        }
      } finally {
        if (observer !== connection) observer.close()
      }
    } finally {
      connection.database.transaction = original
      connection.close()
    }
  },
}
declare global {
  interface Window {
    idbTouch: typeof api
  }
}
window.idbTouch = api
