import { open, repo, snapshot, text, value } from './createHarness'
import { ROOT_NODE_ID, VFS_LIMITS } from '../../../src/core/filesystem/policy'
import { STORES } from '../../../src/core/storage/schema'
import { transactionDone } from '../../../src/core/storage/requests'
import { validateStoredMetadata } from '../../../src/core/storage/readRepository'
import { createMemoryVfsRepository } from '../../../src/core/filesystem/memoryRepository'
import { decodeNode } from '../../../src/core/storage/records'
import type {
  ContentId,
  NodeId,
  VfsChange,
} from '../../../src/core/filesystem/types'
import type { VfsCreateRepository } from '../../../src/core/storage/createRepository'
export type CopyFailure =
  | 'missing-source'
  | 'directory-source'
  | 'missing-content'
  | 'bad-content'
  | 'bad-parent'
  | 'missing-target'
  | 'file-target'
  | 'system-target'
  | 'invalid-name'
  | 'duplicate'
  | 'node-collision'
  | 'content-collision'
  | 'factory'
  | 'timestamp'
  | 'operation'
  | 'counter'
  | 'parent-overflow'
  | 'quota'
  | 'abort'
  | 'closed'
async function workflow(repository: VfsCreateRepository) {
  const folder = value(await repository.createDirectory(ROOT_NODE_ID, 'copies'))
  const source = value(
    await repository.createFile(ROOT_NODE_ID, 'Café.txt', text('Привет 🌍')),
  )
  const original = value(await repository.readDocument(source))
  const events: VfsChange[] = []
  repository.subscribe({ kind: 'all' }, (event) => {
    events.push(event)
  })
  const copy = value(await repository.copyFile(source, folder))
  const copied = value(await repository.readDocument(copy))
  const sourceAfterCopy = await repository.readDocument(source)
  const renamed = value(await repository.copyFile(source, folder, 'other'))
  const duplicate = await repository.copyFile(source, folder, 'Cafe\u0301.txt')
  const sourceSave = await repository.writeFile(
    source,
    text('source changed'),
    { expectedContentRevision: 1, requestId: 'source-save' },
  )
  const copySave = await repository.writeFile(copy, text('copy changed'), {
    expectedContentRevision: 1,
    requestId: 'copy-save',
  })
  return {
    folder,
    source,
    copy,
    renamed,
    original,
    copied,
    sourceAfterCopy,
    // Diagnostic wording/context is adapter-specific; public parity uses error codes.
    duplicate: duplicate.ok
      ? duplicate
      : { ok: false as const, error: { code: duplicate.error.code } },
    sourceSave,
    copySave,
    events,
    sourceAfter: await repository.readDocument(source),
    copyAfter: await repository.readDocument(copy),
    secondCopy: await repository.readDocument(renamed),
    parent: await repository.getNode(folder),
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
          now: () => 45,
          createNodeId: () => `copy-${n++}` as NodeId,
          createContentId: () => `copy-content-${c++}` as ContentId,
          createOperationId: () => `copy-operation-${o++}`,
        }
      }
      return {
        actual: await workflow(repo(connection, options())),
        expected: await workflow(
          value(
            createMemoryVfsRepository({ ...options(), initialNodes: initial }),
          ),
        ),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async read(name: string, id: NodeId) {
    const connection = await open(name)
    try {
      return await repo(connection).readDocument(id)
    } finally {
      connection.close()
    }
  },
  async protectedSource(name: string) {
    const connection = await open(name),
      observer = await open(name)
    try {
      const initial = repo(connection),
        file = value(await initial.createFile(ROOT_NODE_ID, 'source', text('')))
      const node = value(await initial.readDocument(file)).node
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
      const tx = connection.database.transaction(STORES.nodes, 'readwrite'),
        done = transactionDone(tx)
      tx.objectStore(STORES.nodes).put({
        ...node,
        parentId: system,
        mime: 'application/json',
        metadata: { protected: true },
      })
      await done
      let errors = 0
      const repository = repo(connection, {
          onListenerError: () => {
            errors++
          },
        }),
        events: VfsChange[] = [],
        reads: Promise<unknown>[] = []
      repository.subscribe({ kind: 'all' }, () => {
        throw new Error('listener')
      })
      const unsubscribe = repository.subscribe(
        { kind: 'directory', id: ROOT_NODE_ID },
        (event) => {
          events.push(event)
          reads.push(repo(observer).readDocument(event.contentIds[0]))
        },
      )
      const copy = value(await repository.copyFile(file, ROOT_NODE_ID))
      const source = await repository.readDocument(file),
        document = await repository.readDocument(copy)
      unsubscribe()
      const second = await repository.copyFile(file, ROOT_NODE_ID, 'second')
      return {
        copy,
        source,
        document,
        second,
        events,
        reads: await Promise.all(reads),
        errors,
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
      observer.close()
    }
  },
  async failure(name: string, mode: CopyFailure) {
    const connection = await open(name)
    try {
      const initial = repo(connection),
        folder = value(await initial.createDirectory(ROOT_NODE_ID, 'target')),
        file = value(
          await initial.createFile(ROOT_NODE_ID, 'source', text('original')),
        )
      const node = value(await initial.readDocument(file)).node
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
      if (mode === 'duplicate')
        value(await initial.createDirectory(folder, 'source'))
      if (
        [
          'missing-content',
          'bad-content',
          'bad-parent',
          'counter',
          'parent-overflow',
        ].includes(mode)
      ) {
        const parent = value(await initial.getNode(folder))
        const tx = connection.database.transaction(
            [STORES.nodes, STORES.contents, STORES.meta],
            'readwrite',
          ),
          done = transactionDone(tx)
        if (mode === 'missing-content')
          tx.objectStore(STORES.contents).delete(node.contentId)
        if (mode === 'bad-content')
          tx.objectStore(STORES.contents).put({
            id: node.contentId,
            content: text('wrong size'),
          })
        if (mode === 'bad-parent')
          tx.objectStore(STORES.nodes).put({
            ...node,
            parentId: 'missing' as NodeId,
          })
        if (mode === 'counter')
          tx.objectStore(STORES.meta).put({
            key: 'totals',
            nodeCount: 999,
            textBytes: 8,
          })
        if (mode === 'parent-overflow')
          tx.objectStore(STORES.nodes).put({
            ...parent,
            metadataRevision: Number.MAX_SAFE_INTEGER,
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
            ? () => node.contentId
            : () => crypto.randomUUID() as ContentId,
        now: mode === 'timestamp' ? () => NaN : () => 46,
        createOperationId:
          mode === 'operation' ? () => ' ' : () => crypto.randomUUID(),
      })
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const original = connection.database.transaction.bind(connection.database)
      if (mode === 'quota' || mode === 'abort')
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
      if (mode === 'closed') connection.close()
      const source =
        mode === 'missing-source'
          ? ('missing' as NodeId)
          : mode === 'directory-source'
            ? folder
            : file
      const destination =
        mode === 'missing-target'
          ? ('missing' as NodeId)
          : mode === 'file-target'
            ? file
            : mode === 'system-target'
              ? system
              : folder
      const result = await repository.copyFile(
        source,
        destination,
        mode === 'invalid-name' ? '..' : undefined,
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
  async boundary(name: string) {
    const connection = await open(name)
    try {
      const repository = repo(connection)
      const source = value(
        await repository.createFile(
          ROOT_NODE_ID,
          'maximum',
          text('a'.repeat(VFS_LIMITS.maxFileBytes)),
        ),
      )
      const duplicate = await repository.copyFile(source, ROOT_NODE_ID)
      const copy = value(
        await repository.copyFile(source, ROOT_NODE_ID, 'maximum-copy'),
      )
      return {
        duplicate,
        document: await repository.readDocument(copy),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async race(name: string, kind: 'sibling' | 'save' | 'budget' | 'nodes') {
    const first = await open(name),
      second = await open(name)
    try {
      const a = repo(first),
        b = repo(second),
        file = value(
          await a.createFile(
            ROOT_NODE_ID,
            'source',
            text(kind === 'budget' ? 'a' : 'old 🌍'),
          ),
        )
      const folder = value(await a.createDirectory(ROOT_NODE_ID, 'copies'))
      if (kind === 'budget') {
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
            text('a'.repeat(VFS_LIMITS.maxFileBytes - 2)),
          ),
        )
      }
      if (kind === 'nodes') {
        const tx = first.database.transaction(
            [STORES.nodes, STORES.meta],
            'readwrite',
          ),
          done = transactionDone(tx)
        for (let i = 8; i < VFS_LIMITS.maxNodes - 1; i++)
          tx.objectStore(STORES.nodes).add({
            id: `bulk-${i}`,
            kind: 'directory',
            parentId: ROOT_NODE_ID,
            name: `bulk-${i}`,
            createdAt: 45,
            updatedAt: 45,
            metadataRevision: 1,
            metadata: { protected: false },
          })
        tx.objectStore(STORES.meta).put({
          key: 'totals',
          nodeCount: VFS_LIMITS.maxNodes - 1,
          textBytes: 8,
        })
        await done
      }
      const results = await Promise.all([
        a.copyFile(file, folder, 'first'),
        kind === 'save'
          ? b.writeFile(file, text('new é'), {
              expectedContentRevision: 1,
              requestId: 'save',
            })
          : b.copyFile(file, folder, kind === 'sibling' ? 'first' : 'second'),
      ])
      const copies = []
      for (const entry of value(await a.getChildren(folder)))
        copies.push(await a.readDocument(entry.id))
      return {
        results,
        copies,
        source: await a.readDocument(file),
        audit: await validateStoredMetadata(first),
      }
    } finally {
      first.close()
      second.close()
    }
  },
}
declare global {
  interface Window {
    idbCopy: typeof api
  }
}
window.idbCopy = api
