import { expect, it } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { ROOT_NODE_ID } from './policy'
import { createInitialNodes } from './seed'
import type { ContentId, NodeId, VfsResult } from './types'
function value<T>(result: VfsResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
async function setup() {
  let n = 0,
    c = 0,
    op = 0
  const options = {
    now: () => 1,
    createNodeId: () => `node-${++n}` as NodeId,
    createContentId: () => `content-${++c}` as ContentId,
    createOperationId: () => `op-${++op}`,
  }
  const vfs = createVfsService(value(createMemoryVfsRepository(options)))
  const docs = value(await vfs.resolve('/home/user/Documents', ROOT_NODE_ID))
  const desktop = value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID))
  const file = value(
    await vfs.createFile(docs, 'note.txt', {
      kind: 'text',
      encoding: 'utf-8',
      text: 'original',
    }),
  )
  return { vfs, options, docs, desktop, file }
}

it('renames with NFC while preserving document identity and allowing an already-read revision to save', async () => {
  const { vfs, options, docs, file } = await setup()
  const before = value(await vfs.readFile(file))
  const parent = value(await vfs.stat(docs))
  options.now = () => 2
  expect((await vfs.rename(file, 'Cafe\u0301 notes.txt')).ok).toBe(true)
  const after = value(await vfs.readFile(file))
  expect(after.node).toMatchObject({
    id: file,
    name: 'Café notes.txt',
    contentId: before.node.contentId,
    contentRevision: 1,
    metadataRevision: 2,
    updatedAt: 2,
  })
  expect(after.content).toBe(before.content)
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(
    parent.metadataRevision + 1,
  )
  expect(await vfs.resolve('note.txt', docs)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  expect(value(await vfs.resolve('Café notes.txt', docs))).toBe(file)
  expect(
    (
      await vfs.writeFile(
        file,
        { kind: 'text', encoding: 'utf-8', text: 'saved' },
        { expectedContentRevision: before.contentRevision, requestId: 'save' },
      )
    ).ok,
  ).toBe(true)
})
it('moves with optional rename, updates both parents once, and retains content revision', async () => {
  const { vfs, docs, desktop, file } = await setup()
  const old = value(await vfs.stat(docs))
  const target = value(await vfs.stat(desktop))
  const document = value(await vfs.readFile(file))
  expect((await vfs.move(file, desktop, 'Moved.txt')).ok).toBe(true)
  expect(value(await vfs.pathOf(file))).toBe('/home/user/Desktop/Moved.txt')
  expect(value(await vfs.listDirectory(docs))).toEqual([])
  expect(value(await vfs.resolve('Moved.txt', desktop))).toBe(file)
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(
    old.metadataRevision + 1,
  )
  expect(value(await vfs.stat(desktop)).metadataRevision).toBe(
    target.metadataRevision + 1,
  )
  expect(value(await vfs.readFile(file)).content).toBe(document.content)
  expect(value(await vfs.readFile(file)).contentRevision).toBe(
    document.contentRevision,
  )
})
it('directory move changes descendant paths without rewriting their records', async () => {
  const { vfs, docs, desktop } = await setup()
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const child = value(await vfs.createDirectory(folder, 'nested'))
  const leaf = value(
    await vfs.createFile(child, 'file', {
      kind: 'text',
      encoding: 'utf-8',
      text: 'x',
    }),
  )
  const childBefore = value(await vfs.stat(child))
  const leafBefore = value(await vfs.stat(leaf))
  value(await vfs.move(folder, desktop, 'new folder'))
  expect(value(await vfs.pathOf(leaf))).toBe(
    '/home/user/Desktop/new folder/nested/file',
  )
  expect(
    value(
      await vfs.resolve(
        '/home/user/Desktop/new folder/nested/file',
        ROOT_NODE_ID,
      ),
    ),
  ).toBe(leaf)
  expect(value(await vfs.stat(child))).toBe(childBefore)
  expect(value(await vfs.stat(leaf))).toBe(leafBefore)
})
it('rejects self/descendant directory cycles without changing the tree', async () => {
  const { vfs, docs } = await setup()
  const folder = value(await vfs.createDirectory(docs, 'folder'))
  const child = value(await vfs.createDirectory(folder, 'child'))
  const before = value(await vfs.stat(folder))
  for (const target of [folder, child])
    expect(await vfs.move(folder, target)).toMatchObject({
      ok: false,
      error: { code: 'CYCLE' },
    })
  expect(value(await vfs.stat(folder))).toBe(before)
  expect(value(await vfs.pathOf(child))).toBe(
    '/home/user/Documents/folder/child',
  )
})
it('same-parent NFC-equivalent rename/move is a no-op, even when the clock fails', async () => {
  const { vfs, options, docs, file } = await setup()
  value(await vfs.rename(file, 'Café'))
  const before = value(await vfs.stat(file))
  const parent = value(await vfs.stat(docs))
  options.now = () => {
    throw new Error('must not run')
  }
  value(await vfs.rename(file, 'Cafe\u0301'))
  value(await vfs.move(file, docs))
  expect(value(await vfs.stat(file))).toBe(before)
  expect(value(await vfs.stat(docs))).toBe(parent)
})
it('same-parent actual rename increments parent once and permits case-only rename', async () => {
  const { vfs, docs, file } = await setup()
  const parent = value(await vfs.stat(docs))
  value(await vfs.move(file, docs, 'NOTE.txt'))
  expect(value(await vfs.stat(docs)).metadataRevision).toBe(
    parent.metadataRevision + 1,
  )
  expect(value(await vfs.resolve('NOTE.txt', docs))).toBe(file)
})
it('concurrent destination collisions yield one success and preserve the loser', async () => {
  const { vfs, docs, desktop, file } = await setup()
  const other = value(
    await vfs.createFile(docs, 'other', {
      kind: 'text',
      encoding: 'utf-8',
      text: 'other',
    }),
  )
  const before = value(await vfs.stat(other))
  const results = await Promise.all([
    vfs.move(file, desktop, 'Café'),
    vfs.move(other, desktop, 'Cafe\u0301'),
  ])
  expect(results[0].ok).toBe(true)
  expect(results[1]).toMatchObject({
    ok: false,
    error: { code: 'ALREADY_EXISTS' },
  })
  expect(value(await vfs.stat(other))).toBe(before)
  expect(value(await vfs.listDirectory(desktop))).toHaveLength(1)
})
it('never overwrites a file or directory sibling and keeps snapshots on errors', async () => {
  const { vfs, docs, file } = await setup()
  value(await vfs.createDirectory(docs, 'folder'))
  const before = value(await vfs.stat(file))
  const parent = value(await vfs.stat(docs))
  expect(await vfs.rename(file, 'folder')).toMatchObject({
    ok: false,
    error: { code: 'ALREADY_EXISTS' },
  })
  expect(await vfs.rename(file, 'bad/name')).toMatchObject({
    ok: false,
    error: { code: 'INVALID_NAME' },
  })
  expect(value(await vfs.stat(file))).toBe(before)
  expect(value(await vfs.stat(docs))).toBe(parent)
})
it('rejects missing nodes/destinations and file destinations', async () => {
  const { vfs, docs, file } = await setup()
  expect(await vfs.rename('missing' as NodeId, 'name')).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  expect(await vfs.move(file, 'missing' as NodeId)).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  })
  expect(await vfs.move(docs, file)).toMatchObject({
    ok: false,
    error: { code: 'NOT_DIRECTORY' },
  })
})
it('protects root/home/user identities and rejects moves into system', async () => {
  const { vfs, desktop, file } = await setup()
  const system = value(await vfs.resolve('/system', ROOT_NODE_ID))
  for (const path of ['/', '/home', '/home/user', '/system']) {
    const id = value(await vfs.resolve(path, ROOT_NODE_ID))
    expect(await vfs.rename(id, 'renamed')).toMatchObject({
      ok: false,
      error: { code: 'PROTECTED' },
    })
    expect(await vfs.move(id, desktop)).toMatchObject({
      ok: false,
      error: { code: 'PROTECTED' },
    })
  }
  expect(await vfs.move(file, system)).toMatchObject({
    ok: false,
    error: { code: 'PROTECTED' },
  })
})
it('protects nested system nodes even when their own flag is false', async () => {
  let n = 0
  const nodes = createInitialNodes(1, () => `seed-${++n}` as NodeId)
  const system = nodes.find((n) => n.name === 'system')!
  const nested = {
    ...system,
    id: 'nested' as NodeId,
    parentId: system.id,
    name: 'nested',
    metadata: { protected: false },
  }
  const vfs = createVfsService(
    value(
      createMemoryVfsRepository({
        initialNodes: [...nodes, nested],
        now: () => 1,
        createNodeId: () => 'unused' as NodeId,
        createContentId: () => 'unused' as ContentId,
        createOperationId: () => 'unused',
      }),
    ),
  )
  expect(await vfs.rename(nested.id, 'new')).toMatchObject({
    ok: false,
    error: { code: 'PROTECTED' },
  })
})
it.each(['throw', 'invalid'] as const)(
  'rolls back %s clock failure and allows later relocation',
  async (kind) => {
    const { vfs, options, docs, desktop, file } = await setup()
    const before = value(await vfs.readFile(file))
    const old = value(await vfs.stat(docs))
    const target = value(await vfs.stat(desktop))
    options.now = () => {
      if (kind === 'throw') throw new Error('injected')
      return NaN
    }
    expect(await vfs.move(file, desktop, 'new')).toMatchObject({
      ok: false,
      error: {
        code: kind === 'throw' ? 'STORAGE_UNAVAILABLE' : 'CORRUPT_DATA',
      },
    })
    expect(value(await vfs.stat(file))).toBe(before.node)
    expect(value(await vfs.stat(docs))).toBe(old)
    expect(value(await vfs.stat(desktop))).toBe(target)
    expect(value(await vfs.resolve('note.txt', docs))).toBe(file)
    expect(value(await vfs.listDirectory(desktop))).toEqual([])
    options.now = () => 2
    value(await vfs.move(file, desktop, 'new'))
    expect(value(await vfs.readFile(file)).content).toBe(before.content)
  },
)
