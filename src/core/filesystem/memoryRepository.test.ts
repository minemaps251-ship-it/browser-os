import { expect, it } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { createInitialNodes } from './seed'
import { ROOT_NODE_ID } from './policy'
import type {
  ContentId,
  FileNode,
  FileSystemNode,
  NodeId,
  VfsResult,
} from './types'

function value<T>(result: VfsResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
function initial() {
  let next = 0
  return createInitialNodes(123, () => `node-${++next}` as NodeId)
}
function setup(nodes?: readonly FileSystemNode[]) {
  let next = 0
  const repository = value(
    createMemoryVfsRepository({
      now: () => 123,
      createContentId: () => 'new-content' as ContentId,
      createNodeId: () => `node-${++next}` as NodeId,
      initialNodes: nodes,
      initialContents: nodes
        ?.filter((n) => n.kind === 'file')
        .map((n) => ({
          id: n.contentId,
          content: {
            kind: 'text' as const,
            encoding: 'utf-8' as const,
            text: 'abc',
          },
        })),
    }),
  )
  return { repository, vfs: createVfsService(repository) }
}
function fixture() {
  const nodes = initial()
  const parent = nodes.find((node) => node.name === 'Documents')!
  const file: FileNode = {
    id: 'file' as NodeId,
    parentId: parent.id,
    kind: 'file',
    name: 'Café notes.txt',
    createdAt: 123,
    updatedAt: 123,
    metadataRevision: 1,
    metadata: { protected: false },
    mime: 'text/plain',
    byteLength: 3,
    contentId: 'content' as ContentId,
    contentRevision: 1,
  }
  return { nodes: [...nodes, file], file, parent }
}

it('creates the initial tree with stable root, protection, timestamps and empty directories', async () => {
  const { vfs } = setup()
  expect(value(await vfs.stat(ROOT_NODE_ID))).toMatchObject({
    kind: 'directory',
    parentId: null,
    name: '',
    metadata: { protected: true },
    createdAt: 123,
    updatedAt: 123,
  })
  expect(
    value(await vfs.listDirectory(ROOT_NODE_ID)).map((node) => node.name),
  ).toEqual(['home', 'system'])
  for (const path of [
    '/home/user/Documents',
    '/home/user/Desktop',
    '/system',
  ]) {
    const id = value(await vfs.resolve(path, ROOT_NODE_ID))
    expect(value(await vfs.listDirectory(id))).toEqual([])
    expect(value(await vfs.pathOf(id))).toBe(path)
  }
})
it('does not run seed or dependencies when existing nodes are supplied', async () => {
  const existing = fixture()
  const repository = value(
    createMemoryVfsRepository({
      initialNodes: existing.nodes,
      initialContents: [
        {
          id: existing.file.contentId,
          content: { kind: 'text', encoding: 'utf-8', text: 'abc' },
        },
      ],
      now: () => {
        throw new Error('must not seed')
      },
      createContentId: () => 'new-content' as ContentId,
      createNodeId: () => {
        throw new Error('must not seed')
      },
    }),
  )
  expect(value(await repository.getNode(existing.file.id)).name).toBe(
    existing.file.name,
  )
  expect(value(await repository.getChildren(existing.parent.id))).toHaveLength(
    1,
  )
})
it('resolves absolute/relative/current/parent paths and clamps parent at root', async () => {
  const { vfs } = setup()
  const cwd = value(await vfs.resolve('/home/user', ROOT_NODE_ID))
  expect(value(await vfs.resolve('./Documents/../Desktop', cwd))).toBe(
    value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID)),
  )
  expect(value(await vfs.resolve('../../../../', cwd))).toBe(ROOT_NODE_ID)
  expect(value(await vfs.resolve('/', 'missing' as NodeId))).toBe(ROOT_NODE_ID)
  expect(await vfs.resolve('.', 'missing' as NodeId)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
})
it('honors NFC, spaces and case-sensitive names without decoding or expansion', async () => {
  const { nodes, file, parent } = fixture()
  const { vfs } = setup(nodes)
  expect(value(await vfs.resolve('Cafe\u0301 notes.txt', parent.id))).toBe(
    file.id,
  )
  expect(await vfs.resolve('café notes.txt', parent.id)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  expect(await vfs.resolve('~/Documents', ROOT_NODE_ID)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
})
it.each([
  'Café notes.txt/',
  'Café notes.txt/.',
  'Café notes.txt/..',
  'Café notes.txt/child',
])('rejects file traversal or directory intent: %s', async (path) => {
  const { nodes, parent } = fixture()
  const { vfs } = setup(nodes)
  expect(await vfs.resolve(path, parent.id)).toMatchObject({
    ok: false,
    error: { code: 'NOT_DIRECTORY', path },
  })
})
it('does not cancel missing/.. and rejects file cwd even for a single name', async () => {
  const { nodes, file, parent } = fixture()
  const { vfs } = setup(nodes)
  expect(
    await vfs.resolve('missing/../Café notes.txt', parent.id),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  expect(await vfs.resolve('.', file.id)).toMatchObject({
    ok: false,
    error: { code: 'NOT_DIRECTORY' },
  })
  expect(await vfs.resolve('', parent.id)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_PATH' },
  })
  expect(await vfs.resolve('bad\0', parent.id)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_NAME' },
  })
})
it('stat/list/pathOf return typed errors and metadata-only listing', async () => {
  const { nodes, file } = fixture()
  const { vfs } = setup(nodes)
  for (const query of [
    vfs.stat('missing' as NodeId),
    vfs.listDirectory('missing' as NodeId),
    vfs.pathOf('missing' as NodeId),
  ])
    expect(await query).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
  expect(await vfs.listDirectory(file.id)).toMatchObject({
    ok: false,
    error: { code: 'NOT_DIRECTORY' },
  })
  expect(value(await vfs.pathOf(ROOT_NODE_ID))).toBe('/')
  const path = value(await vfs.pathOf(file.id))
  expect(value(await vfs.resolve(path, ROOT_NODE_ID))).toBe(file.id)
})
it('copies/freeze-protects nodes and list results from caller mutation', async () => {
  const { nodes, file, parent } = fixture()
  const { vfs } = setup(nodes)
  const node = value(await vfs.stat(file.id))
  expect(node).not.toBe(file)
  expect(Object.isFrozen(node)).toBe(true)
  expect(Object.isFrozen(node.metadata)).toBe(true)
  expect(Object.isFrozen(value(await vfs.listDirectory(parent.id)))).toBe(true)
  // Source is typed readonly, but JavaScript callers can still mutate it.
  Object.assign(file, {
    name: 'Renamed externally',
    metadata: { protected: true },
  })
  expect(value(await vfs.stat(file.id))).toMatchObject({
    name: 'Café notes.txt',
    metadata: { protected: false },
  })
  expect(value(await vfs.resolve('Café notes.txt', parent.id))).toBe(file.id)
})
it('lists siblings deterministically and supports special object-key names', async () => {
  const { nodes, file, parent } = fixture()
  const extra = ['__proto__', 'constructor', 'A', 'a'].map((name, index) => ({
    ...file,
    id: `extra-${index}` as NodeId,
    contentId: `extra-content-${index}` as ContentId,
    name,
  }))
  const { vfs } = setup([...nodes, ...extra])
  expect(
    value(await vfs.listDirectory(parent.id)).map((node) => node.name),
  ).toEqual(['A', 'Café notes.txt', '__proto__', 'a', 'constructor'])
  expect(value(await vfs.resolve('__proto__', parent.id))).toBe(extra[0].id)
})
it.each([
  'no root',
  'duplicate id',
  'duplicate sibling',
  'orphan',
  'file parent',
  'cycle',
  'noncanonical name',
  'extra root',
  'invalid revision',
  'bad root',
] as const)('rejects corrupt initialization atomically: %s', (kind) => {
  const { nodes, file, parent } = fixture()
  let input: readonly FileSystemNode[] = nodes
  switch (kind) {
    case 'no root':
      input = nodes.filter((n) => n.id !== ROOT_NODE_ID)
      break
    case 'duplicate id':
      input = [...nodes, file]
      break
    case 'duplicate sibling':
      input = [...nodes, { ...file, id: 'copy' as NodeId }]
      break
    case 'orphan':
      input = [
        ...nodes,
        { ...file, id: 'orphan' as NodeId, parentId: 'unknown' as NodeId },
      ]
      break
    case 'file parent':
      input = [...nodes, { ...file, id: 'child' as NodeId, parentId: file.id }]
      break
    case 'cycle':
      input = nodes.map((n) =>
        n.id === parent.id ? { ...parent, parentId: parent.id } : n,
      )
      break
    case 'noncanonical name':
      input = nodes.map((n) =>
        n.id === file.id ? { ...file, name: 'Cafe\u0301' } : n,
      )
      break
    case 'extra root':
      input = [...nodes, { ...parent, id: 'root2' as NodeId, parentId: null }]
      break
    case 'invalid revision':
      input = nodes.map((n) =>
        n.id === file.id ? { ...file, contentRevision: 0 } : n,
      )
      break
    case 'bad root':
      input = nodes.map((n) =>
        n.id === ROOT_NODE_ID ? { ...n, name: 'root' } : n,
      )
      break
  }
  expect(
    createMemoryVfsRepository({
      initialNodes: input,
      now: () => 123,
      createContentId: () => 'new-content' as ContentId,
      createNodeId: () => 'unused' as NodeId,
    }),
  ).toMatchObject({ ok: false, error: { code: 'CORRUPT_DATA' } })
})
it('rejects duplicate generated IDs before a new repository becomes available', () => {
  expect(
    createMemoryVfsRepository({
      now: () => 123,
      createContentId: () => 'new-content' as ContentId,
      createNodeId: () => ROOT_NODE_ID,
    }),
  ).toMatchObject({ ok: false, error: { code: 'CORRUPT_DATA' } })
})
