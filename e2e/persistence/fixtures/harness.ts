import { openDatabase } from '../../../src/core/storage/database'
import { STORES } from '../../../src/core/storage/schema'
import {
  requestResult,
  transactionDone,
} from '../../../src/core/storage/requests'
import type { DatabaseConnection } from '../../../src/core/storage/types'
import type { NodeId } from '../../../src/core/filesystem/types'

function opened(
  result: Awaited<ReturnType<typeof openDatabase>>,
): DatabaseConnection {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}
function nativeOpen(
  name: string,
  version?: number,
  upgrade?: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => upgrade?.(request.result)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function inspect(database: IDBDatabase) {
  const transaction = database.transaction(Object.values(STORES), 'readonly')
  const done = transactionDone(transaction)
  const indexes = [...transaction.objectStore(STORES.nodes).indexNames]
  const requests = Object.values(STORES).map((store) =>
    requestResult(transaction.objectStore(store).getAll()),
  )
  const records = await Promise.all(requests)
  await done
  return {
    version: database.version,
    stores: [...database.objectStoreNames],
    records,
    indexes,
  }
}
async function using<T>(
  name: string,
  action: (connection: DatabaseConnection) => Promise<T>,
) {
  const connection = opened(await openDatabase({ name }))
  try {
    return await action(connection)
  } finally {
    connection.close()
  }
}
const spike = {
  async seed(name: string) {
    return using(name, async (connection) => inspect(connection.database))
  },
  async marker(name: string, write: boolean) {
    return using(name, async (connection) => {
      const transaction = connection.database.transaction(
        STORES.settings,
        write ? 'readwrite' : 'readonly',
      )
      const done = transactionDone(transaction)
      if (write)
        transaction
          .objectStore(STORES.settings)
          .put({ key: 'marker', value: 'reload survives' })
      const result = await requestResult(
        transaction.objectStore(STORES.settings).get('marker'),
      )
      await done
      return result as unknown
    })
  },
  async requestThenAbort(name: string) {
    return using(name, async (connection) => {
      const before = await inspect(connection.database)
      const transaction = connection.database.transaction(
        [STORES.contents, STORES.meta],
        'readwrite',
      )
      const done = transactionDone(transaction).then(
        () => 'complete',
        (error) => (error as DOMException).name,
      )
      transaction
        .objectStore(STORES.meta)
        .put({ key: 'totals', nodeCount: 999, textBytes: 999 })
      const request = transaction
        .objectStore(STORES.contents)
        .add({ id: 'probe', content: 'probe' })
      const order: string[] = []
      request.onsuccess = () => {
        order.push('request success')
        transaction.abort()
      }
      transaction.onabort = () => {
        order.push('transaction abort')
      }
      const outcome = await done
      return {
        outcome,
        order,
        before,
        after: await inspect(connection.database),
      }
    })
  },
  async constraintAbort(name: string) {
    return using(name, async (connection) => {
      const before = await inspect(connection.database)
      const transaction = connection.database.transaction(
        [STORES.nodes, STORES.contents],
        'readwrite',
      )
      const done = transactionDone(transaction).then(
        () => 'complete',
        (error) => (error as DOMException).name,
      )
      transaction
        .objectStore(STORES.contents)
        .add({ id: 'orphan-on-failure', content: 'probe' })
      // Duplicate unique sibling index, distinct primary ID.
      const request = transaction
        .objectStore(STORES.nodes)
        .add({ id: 'one', parentId: 'probe-parent', name: 'same' })
      const first = requestResult(request)
      transaction
        .objectStore(STORES.nodes)
        .add({ id: 'two', parentId: 'probe-parent', name: 'same' })
      await first
      const outcome = await done
      return { outcome, before, after: await inspect(connection.database) }
    })
  },
  async inactive(name: string) {
    return using(name, async (connection) => {
      const transaction = connection.database.transaction(
        STORES.settings,
        'readwrite',
      )
      const done = transactionDone(transaction)
      const store = transaction.objectStore(STORES.settings)
      await requestResult(store.put({ key: 'before-task', value: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      let errorName = ''
      try {
        store.put({ key: 'after-task', value: true })
      } catch (error) {
        errorName = (error as DOMException).name
      }
      await done
      return { errorName }
    })
  },
  async concurrent(name: string) {
    const results = await Promise.all([
      openDatabase({ name }),
      openDatabase({ name }),
    ])
    const connections: DatabaseConnection[] = []
    try {
      for (const result of results) connections.push(opened(result))
      const snapshots = await Promise.all(
        connections.map((connection) => inspect(connection.database)),
      )
      return snapshots
    } finally {
      for (const connection of connections) connection.close()
    }
  },
  async versionChange(name: string, asyncCallback = false) {
    const notifications: (number | null)[] = []
    const connection = opened(
      await openDatabase({
        name,
        onVersionChange: (version) => {
          notifications.push(version)
          if (asyncCallback) return Promise.reject(new Error('async callback'))
          throw new Error('callback')
        },
      }),
    )
    try {
      const upgraded = await nativeOpen(name, 2)
      upgraded.close()
      return {
        closed: connection.closed,
        notifications,
        reopening: await openDatabase({ name }),
      }
    } finally {
      connection.close()
    }
  },
  async blocked(name: string) {
    opened(await openDatabase({ name })).close()
    const blocker = await nativeOpen(name)
    const order: string[] = []
    try {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 2)
        request.onblocked = () => {
          order.push('blocked')
          blocker.close()
        }
        request.onsuccess = () => {
          order.push('opened')
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(request.error)
      })
      return order
    } finally {
      blocker.close()
    }
  },
  async newer(name: string) {
    const database = await nativeOpen(name, 2, (db) =>
      db.createObjectStore('future'),
    )
    const transaction = database.transaction('future', 'readwrite')
    const done = transactionDone(transaction)
    transaction.objectStore('future').put('keep', 'marker')
    await done
    database.close()
    const result = await openDatabase({ name })
    const reopened = await nativeOpen(name)
    try {
      const transaction = reopened.transaction('future', 'readonly')
      const done = transactionDone(transaction)
      const marker = await requestResult(
        transaction.objectStore('future').get('marker'),
      )
      await done
      return { result, marker: marker as unknown, version: reopened.version }
    } finally {
      reopened.close()
    }
  },
  async corrupt(name: string) {
    const database = await nativeOpen(name, 1, (db) =>
      db.createObjectStore('wrong'),
    )
    database.close()
    const result = await openDatabase({ name })
    const reopened = await nativeOpen(name)
    try {
      return { result, stores: [...reopened.objectStoreNames] }
    } finally {
      reopened.close()
    }
  },
  async failedSeed(name: string) {
    const result = await openDatabase({
      name,
      createNodeId: () => 'duplicate' as NodeId,
    })
    const retried = opened(await openDatabase({ name }))
    try {
      return { result, snapshot: await inspect(retried.database) }
    } finally {
      retried.close()
    }
  },
  async abandoned(name: string) {
    opened(await openDatabase({ name })).close()
    const blocker = await nativeOpen(name)
    // Real native request, with version 2 solely to force the lifecycle branches.
    const factory = {
      open: () => indexedDB.open(name, 2),
    } as unknown as IDBFactory
    try {
      const result = await openDatabase({ name, factory })
      blocker.close()
      // Queues behind the abandoned upgrade. It must abort rather than alter v1.
      const reopened = await nativeOpen(name)
      try {
        return {
          result,
          version: reopened.version,
          snapshot: await inspect(reopened),
        }
      } finally {
        reopened.close()
      }
    } finally {
      blocker.close()
    }
  },
  async timeout(name: string) {
    opened(await openDatabase({ name })).close()
    const blocker = await nativeOpen(name)
    let blocked!: () => void
    const blockedEvent = new Promise<void>((resolve) => {
      blocked = resolve
    })
    const aborted = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(name, 2)
      request.onblocked = () => blocked()
      request.onupgradeneeded = () => request.transaction!.abort()
      request.onerror = () => resolve()
      request.onsuccess = () => {
        request.result.close()
        reject(new Error('Upgrade should abort'))
      }
    })
    try {
      await blockedEvent
      // v1 opening queues behind a blocked upgrade, so it cannot finish in time.
      const result = await openDatabase({ name, timeoutMs: 25 })
      blocker.close()
      await aborted
      // Late v1 success must close itself; otherwise this v2 open remains blocked.
      const upgraded = await nativeOpen(name, 2)
      try {
        return { result, version: upgraded.version }
      } finally {
        upgraded.close()
      }
    } finally {
      blocker.close()
    }
  },
  async delete(name: string) {
    if (!name.startsWith('idb-spike-'))
      throw new Error('Only isolated test databases may be deleted')
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Test connection leaked'))
    })
  },
}
declare global {
  interface Window {
    idbSpike: typeof spike
  }
}
window.idbSpike = spike

import './readHarness'

import './createHarness'

import './writeHarness'

import './relocateHarness'

import './copyHarness'
