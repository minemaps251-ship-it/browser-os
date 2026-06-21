import { openDatabase } from '../../../src/core/storage/database'
import {
  createIndexedDbReadRepository,
  validateStoredMetadata,
} from '../../../src/core/storage/readRepository'
import { decodeNode } from '../../../src/core/storage/records'
import { STORES } from '../../../src/core/storage/schema'
import {
  requestResult,
  transactionDone,
} from '../../../src/core/storage/requests'
import { createVfsReadService } from '../../../src/core/filesystem/service'
import { createMemoryVfsRepository } from '../../../src/core/filesystem/memoryRepository'
import { ROOT_NODE_ID } from '../../../src/core/filesystem/policy'
import type {
  ContentId,
  FileNode,
  FileSystemNode,
  NodeId,
  StoredFileContent,
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
const folder = 'read-folder' as NodeId,
  file = 'read-file' as NodeId,
  other = 'read-other' as NodeId
const contentId = 'read-content' as ContentId,
  otherContentId = 'read-other-content' as ContentId
const contents: StoredFileContent[] = [
  {
    id: contentId,
    content: { kind: 'text', encoding: 'utf-8', text: 'Привет 🌍' },
  },
  {
    id: otherContentId,
    content: { kind: 'text', encoding: 'utf-8', text: 'healthy' },
  },
]
async function snapshot(connection: DatabaseConnection) {
  const transaction = connection.database.transaction(
    [STORES.nodes, STORES.contents],
    'readonly',
  )
  const done = transactionDone(transaction)
  const records = requestResult<unknown[]>(
    transaction.objectStore(STORES.nodes).getAll(),
  )
  const contentRecords = requestResult<unknown[]>(
    transaction.objectStore(STORES.contents).getAll(),
  )
  const result = { nodes: await records, contents: await contentRecords }
  await done
  return result
}
async function populate(connection: DatabaseConnection) {
  const query = createVfsReadService(createIndexedDbReadRepository(connection))
  const docs = value(await query.resolve('/home/user/Documents', ROOT_NODE_ID))
  const desktop = value(await query.resolve('/home/user/Desktop', ROOT_NODE_ID))
  const base = {
    createdAt: 10,
    updatedAt: 11,
    metadataRevision: 1,
    metadata: { protected: false },
  }
  const directory: FileSystemNode = {
    ...base,
    id: folder,
    parentId: docs,
    name: 'Папка',
    kind: 'directory',
  }
  const first: FileNode = {
    ...base,
    id: file,
    parentId: folder,
    name: 'Café notes.txt',
    kind: 'file',
    contentId,
    contentRevision: 2,
    byteLength: new TextEncoder().encode(contents[0].content.text).length,
    mime: 'text/plain',
  }
  const second: FileNode = {
    ...first,
    id: other,
    name: '__proto__',
    contentId: otherContentId,
    byteLength: 7,
    contentRevision: 1,
  }
  const transaction = connection.database.transaction(
    [STORES.nodes, STORES.contents, STORES.meta],
    'readwrite',
  )
  const done = transactionDone(transaction)
  for (const node of [directory, first, second])
    transaction.objectStore(STORES.nodes).add(node)
  for (const record of contents)
    transaction.objectStore(STORES.contents).add(record)
  transaction.objectStore(STORES.meta).put({
    key: 'totals',
    nodeCount: 9,
    textBytes: first.byteLength + second.byteLength,
  })
  await done
  return { query, docs, desktop, first, second, directory }
}
function summarized(result: VfsResult<unknown>) {
  return result.ok ? result : { ok: false, code: result.error.code }
}
async function observe(
  query: ReturnType<typeof createVfsReadService>,
  docs: NodeId,
) {
  const results: VfsResult<unknown>[] = [
    await query.stat(file),
    await query.readFile(file),
    await query.listDirectory(folder),
    await query.pathOf(file),
    await query.pathOf(ROOT_NODE_ID),
  ]
  for (const path of [
    'Папка/Cafe\u0301 notes.txt',
    '/home/user/Documents/Папка/__proto__',
    'Папка/Café notes.txt/',
    'Папка/Café notes.txt/..',
    'missing/../Папка',
    '/../../home/user/Documents',
    './Папка/../Папка',
  ])
    results.push(await query.resolve(path, docs))
  results.push(
    await query.resolve('/home/user', 'missing' as NodeId),
    await query.resolve('x', file),
    await query.resolve('x', 'missing' as NodeId),
    await query.stat('missing' as NodeId),
    await query.readFile(folder),
    await query.listDirectory(file),
  )
  return results.map(summarized)
}
export type Corruption =
  | 'missing-parent'
  | 'file-parent'
  | 'cycle'
  | 'missing-root'
  | 'bad-root'
  | 'bad-name'
  | 'bad-revision'
  | 'missing-content'
  | 'bad-unicode'
  | 'byte-mismatch'
  | 'wrong-counter'
  | 'shared-content'
const readSpike = {
  async parity(name: string) {
    const connection = await open(name)
    try {
      const { query, docs } = await populate(connection)
      const records = await snapshot(connection)
      const nodes = records.nodes.map((raw) => value(decodeNode(raw)))
      const memory = value(
        createMemoryVfsRepository({
          initialNodes: nodes,
          initialContents: contents,
          now: () => 1,
          createNodeId: () => 'unused' as NodeId,
          createContentId: () => 'unused' as ContentId,
          createOperationId: () => 'unused',
        }),
      )
      return {
        actual: await observe(query, docs),
        expected: await observe(createVfsReadService(memory), docs),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async persist(name: string, initialize: boolean) {
    const connection = await open(name)
    try {
      if (initialize) await populate(connection)
      const query = createVfsReadService(
        createIndexedDbReadRepository(connection),
      )
      return {
        document: await query.readFile(file),
        path: await query.pathOf(file),
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
    }
  },
  async corrupt(name: string, corruption: Corruption) {
    const connection = await open(name)
    try {
      const { query, first, second, directory } = await populate(connection)
      const root = value(await query.stat(ROOT_NODE_ID))
      const transaction = connection.database.transaction(
        [STORES.nodes, STORES.contents, STORES.meta],
        'readwrite',
      )
      const done = transactionDone(transaction)
      const nodes = transaction.objectStore(STORES.nodes),
        records = transaction.objectStore(STORES.contents)
      if (corruption === 'missing-parent') nodes.delete(folder)
      if (corruption === 'file-parent') nodes.put({ ...first, parentId: other })
      if (corruption === 'cycle') nodes.put({ ...directory, parentId: folder })
      if (corruption === 'missing-root') nodes.delete(ROOT_NODE_ID)
      if (corruption === 'bad-root')
        nodes.put({ ...root, metadata: { protected: false } })
      if (corruption === 'bad-name') nodes.put({ ...first, name: 'Cafe\u0301' })
      if (corruption === 'bad-revision')
        nodes.put({ ...first, contentRevision: 0 })
      if (corruption === 'missing-content') records.delete(contentId)
      if (corruption === 'bad-unicode')
        records.put({
          id: contentId,
          content: { ...contents[0].content, text: '\uD800' },
        })
      if (corruption === 'byte-mismatch')
        records.put({
          id: contentId,
          content: { ...contents[0].content, text: 'wrong length' },
        })
      if (corruption === 'wrong-counter')
        transaction
          .objectStore(STORES.meta)
          .put({ key: 'totals', nodeCount: 9, textBytes: 0 })
      if (corruption === 'shared-content') nodes.put({ ...second, contentId })
      await done
      const before = await snapshot(connection)
      const result = {
        document: await query.readFile(file),
        stat: await query.stat(file),
        listing: await query.listDirectory(folder),
        path: await query.pathOf(file),
        healthy: await query.readFile(other),
        audit: await validateStoredMetadata(connection),
        unchanged: false,
      }
      result.unchanged =
        JSON.stringify(await snapshot(connection)) === JSON.stringify(before)
      return result
    } finally {
      connection.close()
    }
  },
  async closed(name: string) {
    const connection = await open(name)
    const query = createVfsReadService(
      createIndexedDbReadRepository(connection),
    )
    connection.close()
    return {
      node: await query.stat(ROOT_NODE_ID),
      audit: await validateStoredMetadata(connection),
    }
  },
  async coherent(name: string) {
    const connection = await open(name)
    const writer = await open(name)
    try {
      const { query, first } = await populate(connection)
      const oldSnapshot = value(await query.readFile(file))
      const read = query.readFile(file)
      const transaction = writer.database.transaction(
        [STORES.nodes, STORES.contents, STORES.meta],
        'readwrite',
      )
      const done = transactionDone(transaction)
      const changed = {
        kind: 'text' as const,
        encoding: 'utf-8' as const,
        text: 'new committed text',
      }
      const byteLength = new TextEncoder().encode(changed.text).byteLength
      transaction
        .objectStore(STORES.nodes)
        .put({ ...first, byteLength, contentRevision: 3, metadataRevision: 2 })
      transaction
        .objectStore(STORES.contents)
        .put({ id: contentId, content: changed })
      transaction
        .objectStore(STORES.meta)
        .put({ key: 'totals', nodeCount: 9, textBytes: byteLength + 7 })
      const raced = await read
      await done
      return {
        raced,
        after: await query.readFile(file),
        oldSnapshot,
        audit: await validateStoredMetadata(connection),
      }
    } finally {
      connection.close()
      writer.close()
    }
  },
}
declare global {
  interface Window {
    idbRead: typeof readSpike
  }
}
window.idbRead = readSpike
