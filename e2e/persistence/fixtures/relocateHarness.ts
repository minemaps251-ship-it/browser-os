import { open, repo, snapshot, text, value } from './createHarness'
import { ROOT_NODE_ID } from '../../../src/core/filesystem/policy'
import { createMemoryVfsRepository } from '../../../src/core/filesystem/memoryRepository'
import { validateStoredMetadata } from '../../../src/core/storage/readRepository'
import { decodeNode } from '../../../src/core/storage/records'
import { transactionDone } from '../../../src/core/storage/requests'
import { STORES } from '../../../src/core/storage/schema'
import type { VfsCreateRepository } from '../../../src/core/storage/createRepository'
import type {
  ContentId,
  NodeId,
  VfsChange,
} from '../../../src/core/filesystem/types'
export type RelocateFailure =
  | 'missing'
  | 'root'
  | 'protected'
  | 'source-system'
  | 'target-system'
  | 'missing-target'
  | 'file-target'
  | 'invalid-name'
  | 'duplicate'
  | 'self'
  | 'descendant'
  | 'node-overflow'
  | 'parent-overflow'
  | 'missing-parent'
  | 'bad-descendant'
  | 'timestamp'
  | 'operation'
  | 'factory'
  | 'abort'
  | 'quota'
  | 'closed'
async function run(repository: VfsCreateRepository) {
  const a = value(await repository.createDirectory(ROOT_NODE_ID, 'A'))
  const b = value(await repository.createDirectory(ROOT_NODE_ID, 'B'))
  const folder = value(await repository.createDirectory(a, 'folder'))
  const nested = value(await repository.createDirectory(folder, 'nested'))
  const file = value(
    await repository.createFile(nested, 'note.txt', text('Привет 🌍')),
  )
  const original = value(await repository.readDocument(file))
  const events: VfsChange[] = []
  repository.subscribe({ kind: 'all' }, (event) => {
    events.push(event)
  })
  const renamed = await repository.rename(folder, 'Cafe\u0301')
  const moved = await repository.move(folder, b)
  const noop = await repository.move(folder, b, 'Café')
  const relocatedDocument = await repository.readDocument(file)
  const saved = await repository.writeFile(file, text('saved'), {
    expectedContentRevision: 1,
    requestId: 'save-after-move',
  })
  return {
    a,
    b,
    folder,
    nested,
    file,
    original,
    relocatedDocument,
    renamed,
    moved,
    noop,
    saved,
    events,
    path: await repository.pathOf(file),
    document: await repository.readDocument(file),
    parents: await Promise.all([repository.getNode(a), repository.getNode(b)]),
    listing: await repository.getChildren(b),
  }
}
const api = {
  async parity(name: string) {
    const connection = await open(name)
    try {
      const initial = (await snapshot(connection))[0].map((raw) =>
        value(decodeNode(raw)),
      )
      const options = () => {
        let n = 0,
          c = 0,
          o = 0
        return {
          now: () => 43,
          createNodeId: () => `new-${n++}` as NodeId,
          createContentId: () => `content-${c++}` as ContentId,
          createOperationId: () => `operation-${o++}`,
        }
      }
      const memory = value(
        createMemoryVfsRepository({ ...options(), initialNodes: initial }),
      )
      const actual = await run(repo(connection, options())),
        expected = await run(memory)
      // Index traversal order differs; invalidations identify the same affected set.
      for (const result of [actual, expected])
        result.events = result.events.map((event) => ({
          ...event,
          pathIds: [...event.pathIds].sort(),
        }))
      return {
        actual,
        expected,
        audit: await validateStoredMetadata(connection),
        snapshot: await snapshot(connection),
      }
    } finally {
      connection.close()
    }
  },
  async paths(name: string, file: NodeId) {
    const connection = await open(name)
    try {
      const repository = repo(connection)
      return {
        path: await repository.pathOf(file),
        document: await repository.readDocument(file),
      }
    } finally {
      connection.close()
    }
  },
  async noop(name: string) {
    const connection = await open(name)
    try {
      const initial = repo(connection),
        file = value(
          await initial.createFile(ROOT_NODE_ID, 'Café', text('text')),
        )
      let calls = 0
      const repository = repo(connection, {
        now: () => {
          calls++
          throw new Error('must not run')
        },
        createOperationId: () => {
          calls++
          throw new Error('must not run')
        },
      })
      const events: VfsChange[] = []
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const before = await snapshot(connection)
      const rename = await repository.rename(file, 'Cafe\u0301'),
        move = await repository.move(file, ROOT_NODE_ID)
      return {
        rename,
        move,
        calls,
        events,
        unchanged:
          JSON.stringify(before) === JSON.stringify(await snapshot(connection)),
      }
    } finally {
      connection.close()
    }
  },
  async failure(name: string, mode: RelocateFailure) {
    const connection = await open(name)
    try {
      const initial = repo(connection)
      const a = value(await initial.createDirectory(ROOT_NODE_ID, 'A')),
        b = value(await initial.createDirectory(ROOT_NODE_ID, 'B'))
      const nested = value(await initial.createDirectory(a, 'nested'))
      const file = value(await initial.createFile(a, 'file', text('content')))
      value(await initial.createDirectory(b, 'duplicate'))
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
      if (
        [
          'protected',
          'source-system',
          'node-overflow',
          'parent-overflow',
          'missing-parent',
          'bad-descendant',
        ].includes(mode)
      ) {
        const original = value(
          await initial.getNode(
            mode === 'parent-overflow'
              ? b
              : mode === 'bad-descendant'
                ? nested
                : a,
          ),
        )
        const updated =
          mode === 'protected'
            ? { ...original, metadata: { protected: true } }
            : mode === 'source-system'
              ? { ...original, parentId: system }
              : mode === 'missing-parent'
                ? { ...original, parentId: 'missing' as NodeId }
                : mode === 'bad-descendant'
                  ? { ...original, metadataRevision: 0 }
                  : { ...original, metadataRevision: Number.MAX_SAFE_INTEGER }
        const tx = connection.database.transaction(STORES.nodes, 'readwrite'),
          done = transactionDone(tx)
        tx.objectStore(STORES.nodes).put(updated)
        await done
      }
      const before = await snapshot(connection),
        events: VfsChange[] = []
      const repository = repo(connection, {
        now: mode === 'timestamp' ? () => NaN : () => 44,
        createOperationId:
          mode === 'operation'
            ? () => ' '
            : mode === 'factory'
              ? () => {
                  throw new Error('injected')
                }
              : () => crypto.randomUUID(),
      })
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const originalTransaction = connection.database.transaction.bind(
        connection.database,
      )
      if (mode === 'abort' || mode === 'quota')
        connection.database.transaction = (
          ...args: Parameters<IDBDatabase['transaction']>
        ) => {
          const tx = originalTransaction(...args)
          if (args[1] === 'readwrite') {
            const store = tx.objectStore(STORES.nodes),
              put = store.put.bind(store)
            let calls = 0
            store.put = (...putArgs: Parameters<IDBObjectStore['put']>) => {
              calls++
              if (mode === 'quota' && calls === 2)
                throw new DOMException('Injected quota', 'QuotaExceededError')
              const request = put(...putArgs)
              if (mode === 'abort' && calls === 1)
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
          : mode === 'root'
            ? ROOT_NODE_ID
            : a
      const destination =
        mode === 'missing-target'
          ? ('missing' as NodeId)
          : mode === 'file-target'
            ? file
            : mode === 'target-system'
              ? system
              : mode === 'self'
                ? a
                : mode === 'descendant'
                  ? nested
                  : b
      const result = await repository.move(
        target,
        destination,
        mode === 'invalid-name'
          ? '..'
          : mode === 'duplicate'
            ? 'duplicate'
            : undefined,
      )
      connection.database.transaction = originalTransaction
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
  async race(name: string, kind: 'sibling' | 'cycle' | 'save') {
    const first = await open(name),
      second = await open(name)
    try {
      const a = repo(first),
        b = repo(second),
        events: VfsChange[] = []
      const folderA = value(await a.createDirectory(ROOT_NODE_ID, 'A')),
        folderB = value(await a.createDirectory(ROOT_NODE_ID, 'B'))
      const fileA = value(await a.createFile(folderA, 'a', text('old'))),
        fileB = value(await a.createFile(folderA, 'b', text('old')))
      a.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      b.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const results =
        kind === 'cycle'
          ? await Promise.all([
              a.move(folderA, folderB),
              b.move(folderB, folderA),
            ])
          : kind === 'sibling'
            ? await Promise.all([
                a.move(fileA, folderB, 'same'),
                b.move(fileB, folderB, 'same'),
              ])
            : await Promise.all([
                a.move(fileA, folderB, 'renamed'),
                b.writeFile(fileA, text('saved'), {
                  expectedContentRevision: 1,
                  requestId: 'save',
                }),
              ])
      return {
        results,
        events,
        path: await a.pathOf(fileA),
        document: await a.readDocument(fileA),
        audit: await validateStoredMetadata(first),
        snapshot: await snapshot(first),
      }
    } finally {
      first.close()
      second.close()
    }
  },
  async committed(name: string) {
    const connection = await open(name),
      observer = await open(name)
    try {
      const repository = repo(connection),
        file = value(
          await repository.createFile(ROOT_NODE_ID, 'old', text('old')),
        )
      const reads: Promise<unknown>[] = []
      let errors = 0
      const guarded = repo(connection, {
        onListenerError: () => {
          errors++
        },
      })
      guarded.subscribe({ kind: 'all' }, () => {
        throw new Error('listener')
      })
      guarded.subscribe({ kind: 'node', id: file }, () => {
        reads.push(repo(observer).pathOf(file))
      })
      const result = await guarded.rename(file, 'new')
      return {
        result,
        errors,
        reads: await Promise.all(reads),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
      observer.close()
    }
  },
}
declare global {
  interface Window {
    idbRelocate: typeof api
  }
}
window.idbRelocate = api
