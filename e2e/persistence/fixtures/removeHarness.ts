import { open, repo, snapshot, text, value } from './createHarness'
import { ROOT_NODE_ID, VFS_LIMITS } from '../../../src/core/filesystem/policy'
import { createMemoryVfsRepository } from '../../../src/core/filesystem/memoryRepository'
import { decodeNode } from '../../../src/core/storage/records'
import { validateStoredMetadata } from '../../../src/core/storage/readRepository'
import { transactionDone } from '../../../src/core/storage/requests'
import { STORES } from '../../../src/core/storage/schema'
import type { VfsRepository } from '../../../src/core/filesystem/repository'
import type {
  NodeId,
  ContentId,
  RemoveOptions,
  VfsChange,
} from '../../../src/core/filesystem/types'
export type RemoveFailure =
  | 'missing'
  | 'root'
  | 'system'
  | 'system-child'
  | 'protected-descendant'
  | 'not-empty'
  | 'invalid-options'
  | 'bad-descendant'
  | 'bad-parent'
  | 'shared-content'
  | 'counter'
  | 'underflow'
  | 'overflow'
  | 'factory'
  | 'timestamp'
  | 'operation'
  | 'quota'
  | 'abort'
  | 'closed'
async function workflow(repository: VfsRepository) {
  const folder = value(
      await repository.createDirectory(ROOT_NODE_ID, 'folder'),
    ),
    nested = value(await repository.createDirectory(folder, 'nested'))
  const file = value(
      await repository.createFile(nested, 'file', text('Привет 🌍')),
    ),
    outside = value(
      await repository.createFile(ROOT_NODE_ID, 'keep', text('keep')),
    )
  const empty = value(await repository.createDirectory(ROOT_NODE_ID, 'empty'))
  const events: VfsChange[] = []
  repository.subscribe({ kind: 'all' }, (event) => {
    events.push(event)
  })
  const rejected = await repository.remove(folder, { recursive: false })
  const result = await repository.remove(folder, { recursive: true }),
    removedEmpty = await repository.remove(empty, { recursive: false })
  const fileRemoval = await repository.remove(outside, { recursive: false })
  return {
    folder,
    nested,
    file,
    outside,
    empty,
    rejected: rejected.ok
      ? rejected
      : { ok: false as const, error: { code: rejected.error.code } },
    result,
    removedEmpty,
    fileRemoval,
    events: events.map((event) => ({
      ...event,
      removedIds: [...event.removedIds].sort(),
    })),
    missing: await repository.getNode(folder),
    root: await repository.getNode(ROOT_NODE_ID),
    listing: await repository.getChildren(ROOT_NODE_ID),
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
          now: () => 47,
          createNodeId: () => `remove-${n++}` as NodeId,
          createContentId: () => `remove-content-${c++}` as ContentId,
          createOperationId: () => `remove-operation-${o++}`,
        }
      }
      const actual = await workflow(repo(connection, options())),
        expected = await workflow(
          value(
            createMemoryVfsRepository({ ...options(), initialNodes: initial }),
          ),
        )
      // Error wording/context is diagnostic; compare the public code for missing targets.
      for (const result of [actual, expected])
        if (!result.missing.ok)
          result.missing = {
            ok: false,
            error: { code: result.missing.error.code, message: '' },
          }
      return {
        actual,
        expected,
        snapshot: await snapshot(connection),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async read(name: string, id: NodeId) {
    const connection = await open(name)
    try {
      return {
        node: await repo(connection).getNode(id),
        snapshot: await snapshot(connection),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async failure(name: string, mode: RemoveFailure) {
    const connection = await open(name)
    try {
      const initial = repo(connection),
        folder = value(await initial.createDirectory(ROOT_NODE_ID, 'folder')),
        file = value(await initial.createFile(folder, 'file', text('original')))
      const node = value(await initial.readDocument(file)).node,
        parent = value(await initial.getNode(ROOT_NODE_ID)),
        source = value(await initial.getNode(folder))
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
          'system-child',
          'protected-descendant',
          'bad-descendant',
          'bad-parent',
          'shared-content',
          'counter',
          'underflow',
          'overflow',
        ].includes(mode)
      ) {
        const tx = connection.database.transaction(
            [STORES.nodes, STORES.meta],
            'readwrite',
          ),
          done = transactionDone(tx)
        if (mode === 'system-child')
          tx.objectStore(STORES.nodes).put({ ...source, parentId: system })
        if (mode === 'protected-descendant')
          tx.objectStore(STORES.nodes).put({
            ...node,
            metadata: { protected: true },
          })
        if (mode === 'bad-descendant')
          tx.objectStore(STORES.nodes).put({ ...node, metadataRevision: 0 })
        if (mode === 'bad-parent')
          tx.objectStore(STORES.nodes).put({
            ...source,
            parentId: 'missing' as NodeId,
          })
        if (mode === 'shared-content')
          tx.objectStore(STORES.nodes).add({
            ...node,
            id: 'shared' as NodeId,
            name: 'shared',
          })
        if (mode === 'counter')
          tx.objectStore(STORES.meta).put({
            key: 'totals',
            nodeCount: 999,
            textBytes: 8,
          })
        if (mode === 'underflow')
          tx.objectStore(STORES.meta).put({
            key: 'totals',
            nodeCount: 8,
            textBytes: 0,
          })
        if (mode === 'overflow')
          tx.objectStore(STORES.nodes).put({
            ...parent,
            metadataRevision: Number.MAX_SAFE_INTEGER,
          })
        if (mode === 'shared-content')
          tx.objectStore(STORES.meta).put({
            key: 'totals',
            nodeCount: 9,
            textBytes: 16,
          })
        await done
      }
      const before = await snapshot(connection),
        events: VfsChange[] = []
      const repository = repo(connection, {
        now: mode === 'timestamp' ? () => NaN : () => 48,
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
              remove = store.delete.bind(store)
            store.delete = (
              ...removeArgs: Parameters<IDBObjectStore['delete']>
            ) => {
              if (mode === 'quota')
                throw new DOMException('Injected quota', 'QuotaExceededError')
              const request = remove(...removeArgs)
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
            : mode === 'system'
              ? system
              : folder
      const result = await repository.remove(
        target,
        mode === 'invalid-options'
          ? (undefined as unknown as RemoveOptions)
          : { recursive: mode !== 'not-empty' },
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
  async race(
    name: string,
    kind: 'create' | 'save' | 'move' | 'copy' | 'remove',
    competingFirst: boolean,
  ) {
    const first = await open(name),
      second = await open(name)
    try {
      const a = repo(first),
        b = repo(second),
        folder = value(await a.createDirectory(ROOT_NODE_ID, 'folder')),
        file = value(await a.createFile(folder, 'file', text('old')))
      const remove = () => a.remove(folder, { recursive: true })
      const compete = () =>
        kind === 'create'
          ? b.createFile(folder, 'created', text('new'))
          : kind === 'save'
            ? b.writeFile(file, text('saved'), {
                expectedContentRevision: 1,
                requestId: 'save',
              })
            : kind === 'move'
              ? b.move(file, ROOT_NODE_ID)
              : kind === 'copy'
                ? b.copyFile(file, ROOT_NODE_ID)
                : b.remove(folder, { recursive: true })
      const earlier = competingFirst ? compete() : remove()
      const later = competingFirst ? remove() : compete()
      const settled = await Promise.all([earlier, later])
      const results = competingFirst ? [settled[1], settled[0]] : settled
      return {
        results,
        folder: await a.getNode(folder),
        file: await a.getNode(file),
        listing: await a.getChildren(ROOT_NODE_ID),
        snapshot: await snapshot(first),
        audit: await validateStoredMetadata(first),
      }
    } finally {
      first.close()
      second.close()
    }
  },
  async deep(name: string) {
    const connection = await open(name)
    try {
      const tx = connection.database.transaction(
          [STORES.nodes, STORES.meta],
          'readwrite',
        ),
        done = transactionDone(tx)
      for (let index = 0; index < 400; index++)
        tx.objectStore(STORES.nodes).add({
          id: `deep-${index}`,
          name: `level-${index}`,
          parentId: index === 0 ? ROOT_NODE_ID : `deep-${index - 1}`,
          kind: 'directory',
          metadata: { protected: false },
          metadataRevision: 1,
          createdAt: 49,
          updatedAt: 49,
        })
      tx.objectStore(STORES.meta).put({
        key: 'totals',
        nodeCount: 406,
        textBytes: 0,
      })
      await done
      const repository = repo(connection),
        events: VfsChange[] = []
      repository.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      const result = await repository.remove('deep-0' as NodeId, {
        recursive: true,
      })
      return {
        result,
        count: events[0]?.removedIds.length,
        snapshot: await snapshot(connection),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async recovery(
    name: string,
    corruption: 'bad-text' | 'missing-text' | 'none',
  ) {
    const connection = await open(name),
      observer = await open(name)
    try {
      const initial = repo(connection),
        file = value(
          await initial.createFile(
            ROOT_NODE_ID,
            'large',
            text('a'.repeat(VFS_LIMITS.maxFileBytes)),
          ),
        )
      if (corruption !== 'none') {
        const node = value(await initial.readDocument(file)).node
        const tx = connection.database.transaction(
            STORES.contents,
            'readwrite',
          ),
          done = transactionDone(tx)
        if (corruption === 'missing-text')
          tx.objectStore(STORES.contents).delete(node.contentId)
        else
          tx.objectStore(STORES.contents).put({
            id: node.contentId,
            content: text('\ud800'),
          })
        await done
      }
      let errors = 0
      const repository = repo(connection, {
          onListenerError: () => {
            errors++
          },
        }),
        reads: Promise<unknown>[] = []
      repository.subscribe({ kind: 'all' }, () => {
        throw new Error('listener')
      })
      const unsubscribe = repository.subscribe(
        { kind: 'node', id: file },
        () => {
          reads.push(repo(observer).getNode(file))
        },
      )
      const result = await repository.remove(file, { recursive: false })
      const after = await snapshot(connection)
      unsubscribe()
      const recreated = await repository.createFile(
        ROOT_NODE_ID,
        'large',
        text('a'.repeat(VFS_LIMITS.maxFileBytes)),
      )
      return {
        result,
        after,
        recreated,
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
    idbRemove: typeof api
  }
}
window.idbRemove = api
