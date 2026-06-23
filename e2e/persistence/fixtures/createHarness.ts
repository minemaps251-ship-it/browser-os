import { openDatabase } from '../../../src/core/storage/database'
import { createIndexedDbVfsRepository } from '../../../src/core/storage/createRepository'
import { validateStoredMetadata } from '../../../src/core/storage/readRepository'
import {
  requestResult,
  transactionDone,
} from '../../../src/core/storage/requests'
import { STORES } from '../../../src/core/storage/schema'
import { ROOT_NODE_ID, VFS_LIMITS } from '../../../src/core/filesystem/policy'
import type {
  ContentId,
  NodeId,
  VfsChange,
  VfsResult,
} from '../../../src/core/filesystem/types'
import type { DatabaseConnection } from '../../../src/core/storage/types'
function value<T>(result: VfsResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
async function open(name: string) {
  const result = await openDatabase({ name })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const text = (text: string) => ({
  kind: 'text' as const,
  encoding: 'utf-8' as const,
  text,
})
function repo(
  connection: DatabaseConnection,
  overrides: Partial<Parameters<typeof createIndexedDbVfsRepository>[1]> = {},
) {
  return createIndexedDbVfsRepository(connection, {
    now: () => 42,
    createNodeId: () => crypto.randomUUID() as NodeId,
    createContentId: () => crypto.randomUUID() as ContentId,
    createOperationId: () => crypto.randomUUID(),
    ...overrides,
  })
}
async function snapshot(connection: DatabaseConnection) {
  const tx = connection.database.transaction(
    [STORES.nodes, STORES.contents, STORES.meta],
    'readonly',
  )
  const done = transactionDone(tx)
  const result = await Promise.all(
    [STORES.nodes, STORES.contents, STORES.meta].map((store) =>
      requestResult<unknown[]>(tx.objectStore(store).getAll()),
    ),
  )
  await done
  return result
}
const api = {
  async basics(name: string) {
    const connection = await open(name),
      second = await open(name)
    try {
      const repository = repo(connection),
        events: VfsChange[] = []
      const observations: Promise<VfsResult<unknown>>[] = []
      const unsubscribe = repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
        observations.push(repo(second).getNode(event.pathIds[0]))
      })
      const folder = value(
        await repository.createDirectory(ROOT_NODE_ID, 'Test'),
      )
      const file = value(
        await repository.createFile(
          folder,
          'Cafe\u0301.txt',
          text('Привет 🌍'),
        ),
      )
      const empty = value(
        await repository.createFile(folder, 'empty', text('')),
      )
      const duplicate = await repository.createDirectory(folder, 'Café.txt')
      const protectedParent = value(
        await repository.resolvePath(
          {
            kind: 'absolute',
            segments: [{ kind: 'name', name: 'system' }],
            requiresDirectory: false,
          },
          ROOT_NODE_ID,
        ),
      )
      const protectedResult = await repository.createDirectory(
        protectedParent,
        'blocked',
      )
      const missing = await repository.createDirectory('missing' as NodeId, 'x')
      const notDirectory = await repository.createDirectory(file, 'x')
      const invalidName = await repository.createDirectory(folder, '..')
      const invalidContent = await repository.createFile(
        folder,
        'bad',
        text('\ud800'),
      )
      unsubscribe()
      return {
        folder,
        file,
        events,
        observations: await Promise.all(observations),
        duplicate,
        protectedResult,
        missing,
        notDirectory,
        invalidName,
        invalidContent,
        document: await repository.readDocument(file),
        empty: await repository.readDocument(empty),
        parent: await repository.getNode(folder),
        snapshot: await snapshot(connection),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
      second.close()
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
  async race(name: string, sameName: boolean) {
    const a = await open(name),
      b = await open(name)
    try {
      const first = repo(a),
        second = repo(b)
      const results = await Promise.all([
        first.createFile(ROOT_NODE_ID, 'race', text('🌍')),
        second.createFile(ROOT_NODE_ID, sameName ? 'race' : 'other', text('é')),
      ])
      return {
        results,
        snapshot: await snapshot(a),
        parent: await first.getNode(ROOT_NODE_ID),
        audit: await validateStoredMetadata(a),
      }
    } finally {
      a.close()
      b.close()
    }
  },
  async rollback(
    name: string,
    mode:
      | 'abort'
      | 'node-collision'
      | 'content-collision'
      | 'factory'
      | 'counter'
      | 'closed'
      | 'quota',
  ) {
    const connection = await open(name)
    try {
      const initial = repo(connection)
      const file = value(
        await initial.createFile(ROOT_NODE_ID, 'existing', text('old')),
      )
      const document = value(await initial.readDocument(file))
      if (mode === 'counter') {
        const tx = connection.database.transaction(STORES.meta, 'readwrite'),
          done = transactionDone(tx)
        tx.objectStore(STORES.meta).put({
          key: 'totals',
          nodeCount: 999,
          textBytes: 3,
        })
        await done
      }
      const before = await snapshot(connection),
        events: VfsChange[] = []
      const repository = repo(connection, {
        createNodeId:
          mode === 'node-collision'
            ? () => file
            : mode === 'factory'
              ? () => {
                  throw new Error('injected')
                }
              : () => crypto.randomUUID() as NodeId,
        createContentId:
          mode === 'content-collision'
            ? () => document.node.contentId
            : () => crypto.randomUUID() as ContentId,
      })
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const original = connection.database.transaction.bind(connection.database)
      if (mode === 'abort' || mode === 'quota') {
        connection.database.transaction = (
          ...args: Parameters<IDBDatabase['transaction']>
        ) => {
          const tx = original(...args)
          if (args[1] === 'readwrite') {
            const store = tx.objectStore(STORES.contents),
              add = store.add.bind(store)
            store.add = (...addArgs: Parameters<IDBObjectStore['add']>) => {
              if (mode === 'quota')
                throw new DOMException('Injected quota', 'QuotaExceededError')
              const request = add(...addArgs)
              request.addEventListener('success', () => tx.abort())
              return request
            }
          }
          return tx
        }
      }
      if (mode === 'closed') connection.close()
      const result = await repository.createFile(
        ROOT_NODE_ID,
        'new',
        text('new'),
      )
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
  async limits(name: string, mode: 'file' | 'total' | 'nodes') {
    const connection = await open(name),
      second = await open(name)
    try {
      const first = repo(connection),
        other = repo(second)
      if (mode === 'total') {
        for (let i = 0; i < 9; i++)
          value(
            await first.createFile(
              ROOT_NODE_ID,
              `large-${i}`,
              text('a'.repeat(VFS_LIMITS.maxFileBytes)),
            ),
          )
        value(
          await first.createFile(
            ROOT_NODE_ID,
            'remaining',
            text('a'.repeat(VFS_LIMITS.maxFileBytes - 1)),
          ),
        )
      }
      if (mode === 'nodes') {
        const tx = connection.database.transaction(
            [STORES.nodes, STORES.meta],
            'readwrite',
          ),
          done = transactionDone(tx)
        for (let i = 6; i < VFS_LIMITS.maxNodes - 1; i++)
          tx.objectStore(STORES.nodes).add({
            id: `bulk-${i}`,
            kind: 'directory',
            parentId: ROOT_NODE_ID,
            name: `bulk-${i}`,
            metadataRevision: 1,
            metadata: { protected: false },
            createdAt: 42,
            updatedAt: 42,
          })
        tx.objectStore(STORES.meta).put({
          key: 'totals',
          nodeCount: VFS_LIMITS.maxNodes - 1,
          textBytes: 0,
        })
        await done
      }
      const results =
        mode === 'file'
          ? [
              await first.createFile(
                ROOT_NODE_ID,
                'too-big',
                text('a'.repeat(VFS_LIMITS.maxFileBytes + 1)),
              ),
            ]
          : await Promise.all([
              first.createFile(ROOT_NODE_ID, 'first', text('a')),
              other.createFile(ROOT_NODE_ID, 'second', text('a')),
            ])
      return {
        results,
        audit: await validateStoredMetadata(connection),
        snapshot: await snapshot(connection),
      }
    } finally {
      connection.close()
      second.close()
    }
  },
  async listeners(name: string) {
    const connection = await open(name)
    try {
      let errors = 0,
        deliveries = 0
      const repository = repo(connection, {
        onListenerError: () => {
          errors++
        },
      })
      repository.subscribe({ kind: 'all' }, () => {
        throw new Error('listener')
      })
      const unsubscribe = repository.subscribe(
        { kind: 'directory', id: ROOT_NODE_ID },
        () => {
          deliveries++
        },
      )
      const first = await repository.createDirectory(ROOT_NODE_ID, 'first')
      unsubscribe()
      const second = await repository.createDirectory(ROOT_NODE_ID, 'second')
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
    idbCreate: typeof api
  }
}
window.idbCreate = api

export { open, repo, snapshot, text, value }
