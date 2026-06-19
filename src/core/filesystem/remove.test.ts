import { expect, it } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { createInitialNodes } from './seed'
import { INITIAL_DIRECTORIES, ROOT_NODE_ID, VFS_LIMITS } from './policy'
import type {
  ContentId,
  FileContent,
  FileSystemNode,
  NodeId,
  RemoveOptions,
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
function setup(initialNodes?: readonly FileSystemNode[]) {
  let n = 0,
    c = 0
  const options = {
    initialNodes,
    now: () => 1,
    createNodeId: () => `new-${++n}` as NodeId,
    createContentId: () => `content-${++c}` as ContentId,
    createOperationId: () => 'operation',
  }
  return {
    vfs: createVfsService(value(createMemoryVfsRepository(options))),
    options,
  }
}
async function fixture() {
  const { vfs, options } = setup()
  const docs = value(await vfs.resolve('/home/user/Documents', ROOT_NODE_ID))
  const desktop = value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID))
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const file = value(await vfs.createFile(folder, 'note', text('Привет 🌍')))
  return { vfs, options, docs, desktop, folder, file }
}
it('removes a file, updates its parent once and leaves existing snapshots immutable', async () => {
  const { vfs, options, folder, file, docs } = await fixture()
  const document = value(await vfs.readFile(file))
  const parent = value(await vfs.stat(folder))
  const ancestor = value(await vfs.stat(docs))
  options.now = () => 2
  value(await vfs.remove(file, { recursive: false }))
  expect(value(await vfs.stat(folder))).toMatchObject({
    metadataRevision: parent.metadataRevision + 1,
    updatedAt: 2,
  })
  expect(value(await vfs.stat(docs))).toBe(ancestor)
  expect(value(await vfs.listDirectory(folder))).toEqual([])
  for (const result of [
    await vfs.stat(file),
    await vfs.readFile(file),
    await vfs.pathOf(file),
    await vfs.resolve('note', folder),
  ])
    expect(result).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  expect(document.content.text).toBe('Привет 🌍')
  expect(
    await vfs.writeFile(file, text('stale'), {
      expectedContentRevision: document.contentRevision,
      requestId: 'stale-save',
    }),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  value(await vfs.createFile(folder, 'note', text('new identity')))
})
it('rejects nonempty directories without recursion and allows empty ones', async () => {
  const { vfs, docs, folder, file } = await fixture()
  const parent = value(await vfs.stat(docs))
  expect(await vfs.remove(folder, { recursive: false })).toMatchObject({
    ok: false,
    error: { code: 'NOT_EMPTY' },
  })
  expect(value(await vfs.stat(docs))).toBe(parent)
  expect(value(await vfs.readFile(file)).content.text).toBe('Привет 🌍')
  const empty = value(await vfs.createDirectory(docs, 'empty'))
  value(await vfs.remove(empty, { recursive: false }))
  expect(await vfs.stat(empty)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
})
it('removes a full subtree and all path indexes while retaining siblings', async () => {
  const { vfs, docs, desktop, folder, file } = await fixture()
  const child = value(await vfs.createDirectory(folder, 'nested'))
  const leaf = value(await vfs.createFile(child, 'leaf', text('data')))
  const sibling = value(await vfs.createFile(docs, 'sibling', text('keep')))
  const siblingBefore = value(await vfs.readFile(sibling))
  const desktopBefore = value(await vfs.stat(desktop))
  const parent = value(await vfs.stat(docs))
  value(await vfs.remove(folder, { recursive: true }))
  for (const id of [folder, child, file, leaf])
    expect(await vfs.stat(id)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
  expect(
    await vfs.resolve('/home/user/Documents/folder/nested/leaf', ROOT_NODE_ID),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(
    parent.metadataRevision + 1,
  )
  expect(value(await vfs.readFile(sibling))).toEqual(siblingBefore)
  expect(value(await vfs.stat(desktop))).toBe(desktopBefore)
  value(await vfs.createDirectory(docs, 'folder'))
})
it('rejects missing nodes and requires an explicit boolean recursive option', async () => {
  const { vfs, folder } = await fixture()
  expect(
    await vfs.remove('missing' as NodeId, { recursive: true }),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  for (const options of [undefined, {}, { recursive: 'yes' }]) {
    expect(
      await vfs.remove(folder, options as unknown as RemoveOptions),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    })
  }
})
it('protects root and reserved directories', async () => {
  const { vfs } = setup()
  for (const path of ['/', '/home', '/home/user', '/system']) {
    const id = value(await vfs.resolve(path, ROOT_NODE_ID))
    expect(await vfs.remove(id, { recursive: true })).toMatchObject({
      ok: false,
      error: { code: 'PROTECTED' },
    })
  }
})
it.each(['file', 'directory'] as const)(
  'rejects the entire removal with a protected %s descendant',
  async (kind) => {
    let n = 0
    const nodes = createInitialNodes(1, () => `seed-${++n}` as NodeId)
    const docs = nodes.find((node) => node.name === 'Documents')!.id
    const folder: FileSystemNode = {
      id: 'folder' as NodeId,
      parentId: docs,
      name: 'folder',
      kind: 'directory',
      createdAt: 1,
      updatedAt: 1,
      metadataRevision: 1,
      metadata: { protected: false },
    }
    const ordinary: FileSystemNode = {
      ...folder,
      id: 'ordinary' as NodeId,
      parentId: folder.id,
      name: 'ordinary',
    }
    const base = {
      ...folder,
      id: 'locked' as NodeId,
      parentId: folder.id,
      name: 'locked',
      metadata: { protected: true },
    }
    const protectedNode: FileSystemNode =
      kind === 'directory'
        ? base
        : {
            ...base,
            kind: 'file',
            contentId: 'locked-content' as ContentId,
            contentRevision: 1,
            byteLength: 4,
            mime: 'text/plain',
          }
    const vfs = createVfsService(
      value(
        createMemoryVfsRepository({
          initialNodes: [...nodes, folder, ordinary, protectedNode],
          initialContents:
            protectedNode.kind === 'file'
              ? [{ id: protectedNode.contentId, content: text('keep') }]
              : [],
          now: () => 2,
          createNodeId: () => 'unused' as NodeId,
          createContentId: () => 'unused' as ContentId,
          createOperationId: () => 'unused',
        }),
      ),
    )
    const parent = value(await vfs.stat(docs))
    expect(await vfs.remove(folder.id, { recursive: true })).toMatchObject({
      ok: false,
      error: { code: 'PROTECTED', nodeId: protectedNode.id },
    })
    expect(value(await vfs.stat(docs))).toBe(parent)
    expect(value(await vfs.listDirectory(folder.id))).toHaveLength(2)
    expect((await vfs.stat(ordinary.id)).ok).toBe(true)
    expect(
      await vfs.remove(protectedNode.id, { recursive: true }),
    ).toMatchObject({ ok: false, error: { code: 'PROTECTED' } })
  },
)
it('protects unflagged system descendants', async () => {
  let n = 0
  const nodes = createInitialNodes(1, () => `seed-${++n}` as NodeId)
  const system = nodes.find((node) => node.name === 'system')!.id
  const child: FileSystemNode = {
    id: 'child' as NodeId,
    parentId: system,
    name: 'child',
    kind: 'directory',
    createdAt: 1,
    updatedAt: 1,
    metadataRevision: 1,
    metadata: { protected: false },
  }
  const { vfs } = setup([...nodes, child])
  expect(await vfs.remove(child.id, { recursive: true })).toMatchObject({
    ok: false,
    error: { code: 'PROTECTED' },
  })
})
it.each(['throw', 'invalid'] as const)(
  'rolls back subtree removal on %s clock and allows retry',
  async (kind) => {
    const { vfs, options, docs, folder, file } = await fixture()
    const parent = value(await vfs.stat(docs))
    const source = value(await vfs.readFile(file))
    options.now = () => {
      if (kind === 'throw') throw new Error('clock')
      return NaN
    }
    expect(await vfs.remove(folder, { recursive: true })).toMatchObject({
      ok: false,
      error: {
        code: kind === 'throw' ? 'STORAGE_UNAVAILABLE' : 'CORRUPT_DATA',
      },
    })
    expect(value(await vfs.stat(docs))).toBe(parent)
    expect(value(await vfs.readFile(file))).toEqual(source)
    expect(value(await vfs.resolve('folder/note', docs))).toBe(file)
    options.now = () => 2
    value(await vfs.remove(folder, { recursive: true }))
  },
)
it('rejects parent revision overflow before removal', async () => {
  let n = 0
  const nodes = createInitialNodes(1, () => `seed-${++n}` as NodeId)
  const docs = nodes.find((node) => node.name === 'Documents')!.id
  const child: FileSystemNode = {
    id: 'child' as NodeId,
    parentId: docs,
    name: 'child',
    kind: 'directory',
    createdAt: 1,
    updatedAt: 1,
    metadataRevision: 1,
    metadata: { protected: false },
  }
  const { vfs } = setup([
    ...nodes.map((node) =>
      node.id === docs
        ? { ...node, metadataRevision: Number.MAX_SAFE_INTEGER }
        : node,
    ),
    child,
  ])
  expect(await vfs.remove(child.id, { recursive: false })).toMatchObject({
    ok: false,
    error: { code: 'CORRUPT_DATA' },
  })
  expect((await vfs.stat(child.id)).ok).toBe(true)
})
it('serializes repeated removals and rejects later saves instead of recreating the file', async () => {
  const { vfs, file, folder } = await fixture()
  const parent = value(await vfs.stat(folder))
  const results = await Promise.all([
    vfs.remove(file, { recursive: false }),
    vfs.remove(file, { recursive: true }),
    vfs.writeFile(file, text('save'), {
      expectedContentRevision: 1,
      requestId: 'save',
    }),
  ])
  expect(results[0].ok).toBe(true)
  expect(results[1]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  expect(results[2]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
  expect(value(await vfs.stat(folder)).metadataRevision).toBe(
    parent.metadataRevision + 1,
  )
})
it('cleans up content records so their IDs can be reused safely', async () => {
  const { vfs, options, file, folder } = await fixture()
  const contentId = value(await vfs.readFile(file)).node.contentId
  value(await vfs.remove(file, { recursive: false }))
  options.createContentId = () => contentId
  const replacement = value(
    await vfs.createFile(folder, 'replacement', text('replacement')),
  )
  expect(value(await vfs.readFile(replacement)).content.text).toBe(
    'replacement',
  )
})
it('releases the exact subtree byte budget for a later create', async () => {
  const { vfs, docs, folder, file } = await fixture()
  const size = value(await vfs.readFile(file)).node.byteLength
  const chunk = 'x'.repeat(VFS_LIMITS.maxFileBytes)
  for (let i = 0; i < 9; i++)
    value(await vfs.createFile(docs, `large-${i}`, text(chunk)))
  value(
    await vfs.createFile(
      docs,
      'remaining',
      text('x'.repeat(VFS_LIMITS.maxFileBytes - size)),
    ),
  )
  expect(await vfs.copyFile(file, docs, 'overflow')).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  value(await vfs.remove(folder, { recursive: true }))
  value(await vfs.createFile(docs, 'fits', text('Привет 🌍')))
  expect(await vfs.createFile(docs, 'overflow', text('x'))).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
})
it('iteratively removes a deep subtree and releases node capacity', async () => {
  const { vfs, docs, folder } = await fixture()
  let parent = folder
  for (
    let count = INITIAL_DIRECTORIES.length + 2;
    count < VFS_LIMITS.maxNodes;
    count++
  )
    parent = value(await vfs.createDirectory(parent, `level-${count}`))
  expect(await vfs.createDirectory(docs, 'overflow')).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  value(await vfs.remove(folder, { recursive: true }))
  expect(value(await vfs.listDirectory(docs))).toEqual([])
  expect(await vfs.stat(parent)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  value(await vfs.createDirectory(docs, 'after'))
})
