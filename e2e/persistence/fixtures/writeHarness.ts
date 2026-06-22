import { open, repo, snapshot, text, value } from './createHarness'
import { ROOT_NODE_ID, VFS_LIMITS } from '../../../src/core/filesystem/policy'
import { validateStoredMetadata } from '../../../src/core/storage/readRepository'
import { transactionDone } from '../../../src/core/storage/requests'
import { STORES } from '../../../src/core/storage/schema'
import type {
  DocumentRead,
  VfsResult,
  FileNode,
  NodeId,
  VfsChange,
  WriteOptions,
} from '../../../src/core/filesystem/types'
import type { DatabaseConnection } from '../../../src/core/storage/types'
export type FailureMode =
  | 'stale'
  | 'missing'
  | 'directory'
  | 'protected'
  | 'system'
  | 'invalid-options'
  | 'invalid-text'
  | 'file-limit'
  | 'missing-content'
  | 'bad-content'
  | 'counter'
  | 'parent'
  | 'overflow'
  | 'factory'
  | 'timestamp'
  | 'operation'
  | 'abort'
  | 'quota'
  | 'closed'
async function edit(
  connection: DatabaseConnection,
  operation: (tx: IDBTransaction) => void,
) {
  const tx = connection.database.transaction(
    [STORES.nodes, STORES.contents, STORES.meta],
    'readwrite',
  )
  const done = transactionDone(tx)
  operation(tx)
  await done
}
const api = {
  async saves(name: string) {
    const connection = await open(name),
      observer = await open(name)
    try {
      const repository = repo(connection),
        events: VfsChange[] = []
      const file = value(
        await repository.createFile(ROOT_NODE_ID, 'save.txt', text('old')),
      )
      const before = value(await repository.readDocument(file)),
        parentBefore = value(await repository.getNode(ROOT_NODE_ID))
      const observations: Promise<VfsResult<DocumentRead>>[] = []
      repository.subscribe({ kind: 'node', id: file }, (event) => {
        events.push(event)
        observations.push(repo(observer).readDocument(file))
      })
      const receipts = []
      let revision = 1
      for (const [index, content] of [
        'Привет 🌍',
        'Привет 🌍',
        '',
        'é',
      ].entries()) {
        const receipt = value(
          await repository.writeFile(file, text(content), {
            expectedContentRevision: revision,
            requestId: `save-${index}`,
          }),
        )
        receipts.push(receipt)
        revision = receipt.contentRevision
      }
      return {
        file,
        before,
        parentBefore,
        parentAfter: await repository.getNode(ROOT_NODE_ID),
        document: await repository.readDocument(file),
        receipts,
        events,
        observations: await Promise.all(observations),
        snapshot: await snapshot(connection),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
      observer.close()
    }
  },
  async read(name: string, file: NodeId) {
    const connection = await open(name)
    try {
      return await repo(connection).readDocument(file)
    } finally {
      connection.close()
    }
  },
  async race(name: string) {
    const first = await open(name),
      second = await open(name)
    try {
      const a = repo(first),
        b = repo(second),
        events: VfsChange[] = []
      const file = value(
        await a.createFile(ROOT_NODE_ID, 'raced', text('original')),
      )
      a.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      b.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const results = await Promise.all([
        a.writeFile(file, text('first 🌍'), {
          expectedContentRevision: 1,
          requestId: 'first',
        }),
        b.writeFile(file, text('second é'), {
          expectedContentRevision: 1,
          requestId: 'second',
        }),
      ])
      return {
        results,
        events,
        document: await a.readDocument(file),
        snapshot: await snapshot(first),
        audit: await validateStoredMetadata(first),
      }
    } finally {
      first.close()
      second.close()
    }
  },
  async failure(name: string, mode: FailureMode) {
    const connection = await open(name)
    try {
      const initial = repo(connection)
      const file = value(
        await initial.createFile(ROOT_NODE_ID, 'original', text('original')),
      )
      let node: FileNode = value(await initial.readDocument(file)).node
      if (
        [
          'protected',
          'system',
          'missing-content',
          'bad-content',
          'counter',
          'parent',
          'overflow',
        ].includes(mode)
      ) {
        const system = value(
          await initial.resolvePath(
            {
              kind: 'absolute',
              segments: [{ kind: 'name', name: 'system' }],
              requiresDirectory: false,
            },
            ROOT_NODE_ID,
          ),
        )
        if (mode === 'protected')
          node = { ...node, metadata: { protected: true } }
        if (mode === 'system') node = { ...node, parentId: system }
        if (mode === 'parent')
          node = { ...node, parentId: 'missing-parent' as NodeId }
        if (mode === 'overflow')
          node = { ...node, metadataRevision: Number.MAX_SAFE_INTEGER }
        await edit(connection, (tx) => {
          tx.objectStore(STORES.nodes).put(node)
          if (mode === 'missing-content')
            tx.objectStore(STORES.contents).delete(node.contentId)
          if (mode === 'bad-content')
            tx.objectStore(STORES.contents).put({
              id: node.contentId,
              content: text('\ud800'),
            })
          if (mode === 'counter')
            tx.objectStore(STORES.meta).put({
              key: 'totals',
              nodeCount: 7,
              textBytes: 0,
            })
        })
      }
      const before = await snapshot(connection),
        events: VfsChange[] = []
      const repository = repo(connection, {
        now: mode === 'timestamp' ? () => NaN : () => 43,
        createOperationId:
          mode === 'factory'
            ? () => {
                throw new Error('injected')
              }
            : mode === 'operation'
              ? () => ' '
              : () => crypto.randomUUID(),
      })
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const original = connection.database.transaction.bind(connection.database)
      if (mode === 'abort' || mode === 'quota')
        connection.database.transaction = (
          ...args: Parameters<IDBDatabase['transaction']>
        ) => {
          const tx = original(...args)
          if (args[1] === 'readwrite') {
            const store = tx.objectStore(STORES.contents),
              put = store.put.bind(store)
            store.put = (...putArgs: Parameters<IDBObjectStore['put']>) => {
              if (mode === 'quota')
                throw new DOMException('Injected quota', 'QuotaExceededError')
              const request = put(...putArgs)
              request.addEventListener('success', () => tx.abort())
              return request
            }
          }
          return tx
        }
      if (mode === 'closed') connection.close()
      const target =
        mode === 'missing'
          ? ('missing' as NodeId)
          : mode === 'directory'
            ? ROOT_NODE_ID
            : file
      const options: WriteOptions =
        mode === 'invalid-options'
          ? { expectedContentRevision: 0, requestId: '' }
          : {
              expectedContentRevision: mode === 'stale' ? 2 : 1,
              requestId: 'save',
            }
      const content =
        mode === 'invalid-text'
          ? '\ud800'
          : mode === 'file-limit'
            ? 'a'.repeat(VFS_LIMITS.maxFileBytes + 1)
            : 'updated 🌍'
      const result = await repository.writeFile(target, text(content), options)
      connection.database.transaction = original
      const observer = mode === 'closed' ? await open(name) : connection
      try {
        return {
          result,
          events,
          unchanged:
            JSON.stringify(before) === JSON.stringify(await snapshot(observer)),
        }
      } finally {
        if (observer !== connection) observer.close()
      }
    } finally {
      connection.close()
    }
  },
  async budgetRace(name: string) {
    const first = await open(name),
      second = await open(name)
    try {
      const a = repo(first),
        b = repo(second)
      for (let i = 0; i < 9; i++)
        value(
          await a.createFile(
            ROOT_NODE_ID,
            `large-${i}`,
            text('a'.repeat(VFS_LIMITS.maxFileBytes)),
          ),
        )
      value(
        await a.createFile(
          ROOT_NODE_ID,
          'remaining',
          text('a'.repeat(VFS_LIMITS.maxFileBytes - 1)),
        ),
      )
      const fileA = value(await a.createFile(ROOT_NODE_ID, 'a', text(''))),
        fileB = value(await a.createFile(ROOT_NODE_ID, 'b', text('')))
      const results = await Promise.all([
        a.writeFile(fileA, text('a'), {
          expectedContentRevision: 1,
          requestId: 'a',
        }),
        b.writeFile(fileB, text('b'), {
          expectedContentRevision: 1,
          requestId: 'b',
        }),
      ])
      const full = await snapshot(first)
      const freed = await a.writeFile(fileA, text(''), {
        expectedContentRevision: value(await a.readDocument(fileA))
          .contentRevision,
        requestId: 'free-a',
      })
      const freedB = await b.writeFile(fileB, text(''), {
        expectedContentRevision: value(await b.readDocument(fileB))
          .contentRevision,
        requestId: 'free-b',
      })
      const exact = await a.writeFile(fileA, text('é'), {
        expectedContentRevision: value(await a.readDocument(fileA))
          .contentRevision,
        requestId: 'too-large-total',
      })
      return {
        results,
        full,
        freed,
        freedB,
        exact,
        audit: await validateStoredMetadata(first),
      }
    } finally {
      first.close()
      second.close()
    }
  },
  async boundaries(name: string) {
    const connection = await open(name)
    try {
      const repository = repo(connection)
      const file = value(
        await repository.createFile(ROOT_NODE_ID, 'boundary', text('')),
      )
      const exact = await repository.writeFile(
        file,
        text('a'.repeat(VFS_LIMITS.maxFileBytes)),
        { expectedContentRevision: 1, requestId: 'exact' },
      )
      const before = await snapshot(connection)
      const invalid = []
      for (const options of [
        undefined,
        { expectedContentRevision: NaN, requestId: 'x' },
        { expectedContentRevision: 1.5, requestId: 'x' },
        { expectedContentRevision: -1, requestId: 'x' },
        { expectedContentRevision: 2, requestId: ' ' },
        { expectedContentRevision: 2, requestId: 5 },
      ]) {
        // Deliberately exercise untyped caller input at the repository boundary.
        invalid.push(
          await repository.writeFile(
            file,
            text('bad'),
            options as WriteOptions,
          ),
        )
      }
      return {
        exact,
        invalid,
        unchanged:
          JSON.stringify(before) === JSON.stringify(await snapshot(connection)),
        document: await repository.readDocument(file),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async listener(name: string) {
    const connection = await open(name)
    try {
      let errors = 0,
        deliveries = 0
      const repository = repo(connection, {
        onListenerError: () => {
          errors++
        },
      })
      const file = value(
        await repository.createFile(ROOT_NODE_ID, 'file', text('a')),
      )
      repository.subscribe({ kind: 'node', id: file }, () => {
        throw new Error('listener')
      })
      const unsubscribe = repository.subscribe(
        { kind: 'directory', id: ROOT_NODE_ID },
        () => {
          deliveries++
        },
      )
      const first = await repository.writeFile(file, text('b'), {
        expectedContentRevision: 1,
        requestId: 'first',
      })
      unsubscribe()
      const second = await repository.writeFile(file, text('b'), {
        expectedContentRevision: 2,
        requestId: 'second',
      })
      return {
        first,
        second,
        errors,
        deliveries,
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
}
declare global {
  interface Window {
    idbWrite: typeof api
  }
}
window.idbWrite = api
