import { expect, it } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { createInitialNodes } from './seed'
import { ROOT_NODE_ID, VFS_LIMITS } from './policy'
import type {
  ContentId,
  FileContent,
  FileSystemNode,
  NodeId,
  StoredFileContent,
  VfsResult,
} from './types'
function value<T>(result: VfsResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
const text = (text: string): FileContent => ({
  kind: 'text',
  encoding: 'utf-8',
  text,
})
function seed() {
  let n = 0
  return createInitialNodes(1, () => `seed-${++n}` as NodeId)
}
function setup(
  initialNodes: readonly FileSystemNode[] = seed(),
  initialContents: readonly StoredFileContent[] = [],
  dependencies: {
    createContentId?: () => ContentId
    now?: () => number
    createNodeId?: () => NodeId
  } = {},
) {
  let n = 0
  let c = 0
  const options = {
    initialNodes,
    initialContents,
    now: () => 2,
    createNodeId: () => `created-${++n}` as NodeId,
    createOperationId: () => 'fixture-operation',
    createContentId: () => `content-${++c}` as ContentId,
    ...dependencies,
  }
  const repo = value(createMemoryVfsRepository(options))
  return {
    repo,
    vfs: createVfsService(repo),
    options,
    docs: initialNodes.find((node) => node.name === 'Documents')!.id,
  }
}
it('creates directory/file atomically with normalized names and consistent immutable document', async () => {
  const { vfs, docs } = setup()
  const before = value(await vfs.stat(docs))
  const dir = value(await vfs.createDirectory(docs, 'New folder'))
  const id = value(
    await vfs.createFile(dir, 'Cafe\u0301.txt', text('Привет 😀')),
  )
  const doc = value(await vfs.readFile(id))
  expect(doc.node).toMatchObject({
    kind: 'file',
    name: 'Café.txt',
    mime: 'text/plain',
    byteLength: 17,
    contentRevision: 1,
    metadataRevision: 1,
  })
  expect(doc.content).toEqual(text('Привет 😀'))
  expect(doc.contentRevision).toBe(doc.node.contentRevision)
  expect(Object.isFrozen(doc)).toBe(true)
  expect(Object.isFrozen(doc.content)).toBe(true)
  expect(value(await vfs.stat(docs))).toMatchObject({
    metadataRevision: before.metadataRevision + 1,
    updatedAt: 2,
  })
  expect(value(await vfs.resolve('New folder/Café.txt', docs))).toBe(id)
})
it('creates empty files, isolates caller content and preserves old metadata snapshots', async () => {
  const { vfs, docs } = setup()
  const old = value(await vfs.stat(docs))
  const input = text('')
  const id = value(await vfs.createFile(docs, 'empty', input))
  Object.assign(input, { text: 'external mutation' })
  expect(value(await vfs.readFile(id))).toMatchObject({
    node: { byteLength: 0 },
    content: { text: '' },
  })
  expect(old.metadataRevision).toBe(1)
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(2)
})
it('serializes concurrent NFC duplicate file/directory creates without orphan content', async () => {
  const { vfs, docs } = setup()
  const results = await Promise.all([
    vfs.createFile(docs, 'Cafe\u0301', text('first')),
    vfs.createDirectory(docs, 'Café'),
    vfs.createFile(docs, 'Café', text('last')),
  ])
  expect(results.filter((r) => r.ok)).toHaveLength(1)
  expect(results.slice(1)).toMatchObject([
    { ok: false, error: { code: 'ALREADY_EXISTS' } },
    { ok: false, error: { code: 'ALREADY_EXISTS' } },
  ])
  expect(value(await vfs.listDirectory(docs))).toHaveLength(1)
  expect(value(await vfs.readFile(value(results[0]))).content.text).toBe(
    'first',
  )
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(2)
})
it('does not lose different concurrent creations or parent revisions', async () => {
  const { vfs, docs } = setup()
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      vfs.createFile(docs, `file-${i}`, text(`${i}`)),
    ),
  )
  expect(results.every((r) => r.ok)).toBe(true)
  expect(value(await vfs.listDirectory(docs))).toHaveLength(20)
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(21)
})
it('checks parent, names and protected system subtree; home identity still allows children', async () => {
  const { vfs, docs } = setup()
  const file = value(await vfs.createFile(docs, 'file', text('abc')))
  expect(await vfs.createDirectory(file, 'child')).toMatchObject({
    ok: false,
    error: { code: 'NOT_DIRECTORY' },
  })
  expect(
    await vfs.createFile('missing' as NodeId, 'file', text('')),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  expect(await vfs.createDirectory(docs, '..')).toMatchObject({
    ok: false,
    error: { code: 'INVALID_NAME' },
  })
  const system = value(await vfs.resolve('/system', ROOT_NODE_ID))
  expect(await vfs.createFile(system, 'file', text(''))).toMatchObject({
    ok: false,
    error: { code: 'PROTECTED' },
  })
  const home = value(await vfs.resolve('/home/user', ROOT_NODE_ID))
  expect((await vfs.createDirectory(home, 'Personal')).ok).toBe(true)
})
it('protects nested system directories regardless of their individual protected flag', async () => {
  const nodes = seed()
  const system = nodes.find((n) => n.name === 'system')!
  const child = {
    ...system,
    id: 'system-child' as NodeId,
    parentId: system.id,
    name: 'nested',
    metadata: { protected: false },
  }
  const { vfs } = setup([...nodes, child])
  expect(await vfs.createDirectory(child.id, 'blocked')).toMatchObject({
    ok: false,
    error: { code: 'PROTECTED' },
  })
})
it('enforces UTF-8 exact file limit and leaves metadata untouched on overflow', async () => {
  const { vfs, docs } = setup()
  const id = value(
    await vfs.createFile(
      docs,
      'boundary',
      text('😀'.repeat(VFS_LIMITS.maxFileBytes / 4)),
    ),
  )
  expect(value(await vfs.readFile(id)).node.byteLength).toBe(
    VFS_LIMITS.maxFileBytes,
  )
  const before = value(await vfs.stat(docs))
  expect(
    await vfs.createFile(
      docs,
      'over',
      text('😀'.repeat(VFS_LIMITS.maxFileBytes / 4) + 'a'),
    ),
  ).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
  expect(value(await vfs.stat(docs))).toBe(before)
  expect(value(await vfs.listDirectory(docs))).toHaveLength(1)
})
it('enforces total size including existing content while allowing zero-byte files at the boundary', async () => {
  const nodes: FileSystemNode[] = [...seed()]
  const docs = nodes.find((n) => n.name === 'Documents')!
  const payload = 'a'.repeat(VFS_LIMITS.maxFileBytes)
  const records: StoredFileContent[] = []
  for (let i = 0; i < VFS_LIMITS.maxTotalBytes / VFS_LIMITS.maxFileBytes; i++) {
    const contentId = `existing-content-${i}` as ContentId
    nodes.push({
      id: `existing-${i}` as NodeId,
      parentId: docs.id,
      kind: 'file',
      name: `file-${i}`,
      createdAt: 1,
      updatedAt: 1,
      metadataRevision: 1,
      metadata: { protected: false },
      mime: 'text/plain',
      byteLength: payload.length,
      contentRevision: 1,
      contentId,
    })
    records.push({ id: contentId, content: text(payload) })
  }
  const { vfs } = setup(nodes, records)
  expect((await vfs.createFile(docs.id, 'empty', text(''))).ok).toBe(true)
  const before = value(await vfs.stat(docs.id))
  expect(await vfs.createFile(docs.id, 'overflow', text('a'))).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  expect(value(await vfs.stat(docs.id))).toBe(before)
})
it('enforces node count without consuming a parent revision', async () => {
  const nodes: FileSystemNode[] = [...seed()]
  const template = nodes.find((n) => n.name === 'Documents')!
  while (nodes.length < VFS_LIMITS.maxNodes)
    nodes.push({
      ...template,
      id: `node-${nodes.length}` as NodeId,
      parentId: template.id,
      name: `dir-${nodes.length}`,
    })
  const { vfs } = setup(nodes)
  const before = value(await vfs.stat(template.id))
  expect(await vfs.createDirectory(template.id, 'over')).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  expect(value(await vfs.stat(template.id))).toBe(before)
})
it.each(['\ud800', '\udfff'])(
  'rejects malformed Unicode content %j without creating a file',
  async (invalid) => {
    const { vfs, docs } = setup()
    expect(await vfs.createFile(docs, 'invalid', text(invalid))).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONTENT' },
    })
    expect(value(await vfs.listDirectory(docs))).toEqual([])
  },
)
it.each(['id', 'content', 'time'] as const)(
  'rolls back dependency failure at %s and allows later creation',
  async (phase) => {
    const { vfs, docs, options } = setup()
    const before = value(await vfs.stat(docs))
    if (phase === 'id')
      options.createNodeId = () => {
        throw new Error('injected')
      }
    if (phase === 'content')
      options.createContentId = () => {
        throw new Error('injected')
      }
    if (phase === 'time')
      options.now = () => {
        throw new Error('injected')
      }
    expect(await vfs.createFile(docs, 'failure', text('data'))).toMatchObject({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE' },
    })
    expect(value(await vfs.stat(docs))).toBe(before)
    expect(value(await vfs.listDirectory(docs))).toEqual([])
    options.createNodeId = () => 'recovered' as NodeId
    options.createContentId = () => 'recovered-content' as ContentId
    options.now = () => 3
    const id = value(await vfs.createFile(docs, 'success', text('ok')))
    expect(value(await vfs.readFile(id)).content.text).toBe('ok')
  },
)
it('rejects generated collisions and never overwrites content or parent metadata', async () => {
  const { vfs, docs, options } = setup()
  const first = value(await vfs.createFile(docs, 'first', text('original')))
  const document = value(await vfs.readFile(first))
  const before = value(await vfs.stat(docs))
  options.createContentId = () => document.node.contentId
  expect(await vfs.createFile(docs, 'second', text('overwrite'))).toMatchObject(
    { ok: false, error: { code: 'CORRUPT_DATA' } },
  )
  expect(value(await vfs.readFile(first)).content.text).toBe('original')
  expect(value(await vfs.stat(docs))).toBe(before)
})
it('readFile distinguishes missing nodes from directories', async () => {
  const { vfs, docs } = setup()
  expect(await vfs.readFile(docs)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FILE' },
  })
  expect(await vfs.readFile('missing' as NodeId)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
})
it.each(['missing', 'orphan', 'mismatch', 'duplicate'] as const)(
  'rejects inconsistent initial content: %s',
  async (kind) => {
    const { vfs, docs } = setup()
    const id = value(await vfs.createFile(docs, 'file', text('abc')))
    const file = value(await vfs.stat(id))
    if (file.kind !== 'file') throw new Error('fixture')
    const nodes = [...seed(), file]
    let records: StoredFileContent[] = [
      { id: file.contentId, content: text('abc') },
    ]
    if (kind === 'missing') records = []
    if (kind === 'orphan')
      records.push({ id: 'orphan' as ContentId, content: text('') })
    if (kind === 'mismatch')
      records = [{ id: file.contentId, content: text('longer') }]
    if (kind === 'duplicate') records.push(records[0])
    expect(
      createMemoryVfsRepository({
        initialNodes: nodes,
        initialContents: records,
        createNodeId: () => 'unused' as NodeId,
        createOperationId: () => 'fixture-operation',
        createContentId: () => 'unused' as ContentId,
        now: () => 1,
      }),
    ).toMatchObject({ ok: false, error: { code: 'CORRUPT_DATA' } })
  },
)
