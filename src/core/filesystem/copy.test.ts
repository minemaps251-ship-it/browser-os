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
function setup() {
  let n = 0,
    c = 0
  const options = {
    now: () => 1,
    createNodeId: () => `node-${++n}` as NodeId,
    createContentId: () => `content-${++c}` as ContentId,
    createOperationId: () => 'operation',
  }
  const vfs = createVfsService(value(createMemoryVfsRepository(options)))
  return { vfs, options }
}
async function fixture() {
  const { vfs, options } = setup()
  const docs = value(await vfs.resolve('/home/user/Documents', ROOT_NODE_ID))
  const desktop = value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID))
  const file = value(await vfs.createFile(docs, 'original', text('Привет 🌍')))
  return { vfs, options, docs, desktop, file }
}
it('copies current text into new independent identities and initial revisions', async () => {
  const { vfs, options, docs, desktop, file } = await fixture()
  value(
    await vfs.writeFile(file, text('latest'), {
      expectedContentRevision: 1,
      requestId: 'original-save',
    }),
  )
  const source = value(await vfs.readFile(file))
  const oldParent = value(await vfs.stat(docs))
  const target = value(await vfs.stat(desktop))
  options.now = () => 2
  const copy = value(await vfs.copyFile(file, desktop))
  const document = value(await vfs.readFile(copy))
  expect(copy).not.toBe(file)
  expect(document.node.contentId).not.toBe(source.node.contentId)
  expect(document.node).toMatchObject({
    name: 'original',
    parentId: desktop,
    createdAt: 2,
    updatedAt: 2,
    metadataRevision: 1,
    contentRevision: 1,
    byteLength: 6,
    metadata: { protected: false },
  })
  expect(document.content).toEqual(source.content)
  expect(document.content).not.toBe(source.content)
  expect(value(await vfs.stat(file))).toBe(source.node)
  expect(value(await vfs.stat(docs))).toBe(oldParent)
  expect(value(await vfs.stat(desktop)).metadataRevision).toBe(
    target.metadataRevision + 1,
  )
  value(
    await vfs.writeFile(copy, text('copy edit'), {
      expectedContentRevision: 1,
      requestId: 'copy-save',
    }),
  )
  expect(value(await vfs.readFile(file)).content.text).toBe('latest')
  value(
    await vfs.writeFile(file, text('source edit'), {
      expectedContentRevision: 2,
      requestId: 'source-save',
    }),
  )
  expect(value(await vfs.readFile(copy)).content.text).toBe('copy edit')
})
it('normalizes an explicit copy name and never overwrites a source or sibling', async () => {
  const { vfs, docs, file } = await fixture()
  const copy = value(await vfs.copyFile(file, docs, 'Cafe\u0301'))
  expect(value(await vfs.resolve('Café', docs))).toBe(copy)
  const before = value(await vfs.stat(docs))
  for (const name of [undefined, 'Café', 'Cafe\u0301']) {
    expect(await vfs.copyFile(file, docs, name)).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_EXISTS' },
    })
  }
  expect(value(await vfs.stat(docs))).toBe(before)
  expect(value(await vfs.readFile(file)).content.text).toBe('Привет 🌍')
})
it('serializes competing copies to a single NFC destination name', async () => {
  const { vfs, desktop, file } = await fixture()
  const results = await Promise.all([
    vfs.copyFile(file, desktop, 'Café'),
    vfs.copyFile(file, desktop, 'Cafe\u0301'),
  ])
  expect(results.filter((result) => result.ok)).toHaveLength(1)
  expect(results.find((result) => !result.ok)).toMatchObject({
    error: { code: 'ALREADY_EXISTS' },
  })
  expect(value(await vfs.listDirectory(desktop))).toHaveLength(1)
})
it('rejects missing or directory sources, invalid destinations and names without mutation', async () => {
  const { vfs, docs, desktop, file } = await fixture()
  const before = value(await vfs.stat(desktop))
  for (const [source, destination, name, code] of [
    ['missing', desktop, 'copy', 'NOT_FOUND'],
    [docs, desktop, 'copy', 'NOT_FILE'],
    [file, 'missing', 'copy', 'NOT_FOUND'],
    [file, file, 'copy', 'NOT_DIRECTORY'],
    [file, desktop, 'bad/name', 'INVALID_NAME'],
  ] as const) {
    expect(
      await vfs.copyFile(source as NodeId, destination as NodeId, name),
    ).toMatchObject({ ok: false, error: { code } })
  }
  expect(value(await vfs.stat(desktop))).toBe(before)
  expect(value(await vfs.listDirectory(desktop))).toEqual([])
})
it('allows copying a protected system source, preserves MIME and blocks system destinations', async () => {
  let n = 0
  const nodes = createInitialNodes(1, () => `seed-${++n}` as NodeId)
  const system = nodes.find((node) => node.name === 'system')!.id
  const docs = nodes.find((node) => node.name === 'Documents')!.id
  const source: FileSystemNode = {
    id: 'source' as NodeId,
    parentId: system,
    name: 'config',
    kind: 'file',
    contentId: 'source-content' as ContentId,
    contentRevision: 3,
    metadataRevision: 4,
    byteLength: 2,
    mime: 'application/json',
    createdAt: 1,
    updatedAt: 1,
    metadata: { protected: true },
  }
  const vfs = createVfsService(
    value(
      createMemoryVfsRepository({
        initialNodes: [...nodes, source],
        initialContents: [{ id: source.contentId, content: text('{}') }],
        now: () => 2,
        createNodeId: () => 'copy' as NodeId,
        createContentId: () => 'copy-content' as ContentId,
        createOperationId: () => 'unused',
      }),
    ),
  )
  const copy = value(await vfs.copyFile(source.id, docs))
  expect(value(await vfs.stat(copy))).toMatchObject({
    mime: 'application/json',
    metadata: { protected: false },
    contentRevision: 1,
  })
  expect(await vfs.copyFile(copy, system, 'new')).toMatchObject({
    ok: false,
    error: { code: 'PROTECTED' },
  })
  expect(value(await vfs.readFile(source.id)).content.text).toBe('{}')
})
it.each([
  'clock throws',
  'invalid time',
  'node collision',
  'content collision',
  'content factory throws',
] as const)('rolls back copy when %s', async (kind) => {
  const { vfs, options, desktop, file } = await fixture()
  const source = value(await vfs.readFile(file))
  const parent = value(await vfs.stat(desktop))
  const original = { ...options }
  if (kind === 'clock throws')
    options.now = () => {
      throw new Error('clock')
    }
  if (kind === 'invalid time') options.now = () => NaN
  if (kind === 'node collision') options.createNodeId = () => file
  if (kind === 'content collision')
    options.createContentId = () => source.node.contentId
  if (kind === 'content factory throws')
    options.createContentId = () => {
      throw new Error('identity')
    }
  expect(await vfs.copyFile(file, desktop)).toMatchObject({
    ok: false,
    error: {
      code: kind.includes('throws') ? 'STORAGE_UNAVAILABLE' : 'CORRUPT_DATA',
    },
  })
  expect(value(await vfs.stat(desktop))).toBe(parent)
  expect(value(await vfs.listDirectory(desktop))).toEqual([])
  expect(value(await vfs.readFile(file))).toEqual(source)
  Object.assign(options, original)
  expect((await vfs.copyFile(file, desktop)).ok).toBe(true)
})
it('charges copied UTF-8 bytes and rejects an over-budget copy atomically', async () => {
  const { vfs, docs, desktop, file } = await fixture()
  const bytes = value(await vfs.readFile(file)).node.byteLength
  const chunk = 'x'.repeat(VFS_LIMITS.maxFileBytes)
  for (let i = 0; i < 9; i++)
    value(await vfs.createFile(docs, `large-${i}`, text(chunk)))
  value(
    await vfs.createFile(
      docs,
      'remaining',
      text('x'.repeat(VFS_LIMITS.maxFileBytes - bytes * 2)),
    ),
  )
  value(await vfs.copyFile(file, desktop, 'fits'))
  const parent = value(await vfs.stat(desktop))
  expect(await vfs.copyFile(file, desktop, 'overflow')).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  expect(value(await vfs.stat(desktop))).toBe(parent)
  expect(value(await vfs.listDirectory(desktop))).toHaveLength(1)
})
it('enforces node count when copying an empty file', async () => {
  const { vfs, docs, desktop } = await fixture()
  const empty = value(await vfs.createFile(docs, 'empty', text('')))
  const initialCount = INITIAL_DIRECTORIES.length + 2 // original and empty
  for (let i = initialCount; i < VFS_LIMITS.maxNodes; i++)
    value(await vfs.createDirectory(docs, `dir-${i}`))
  const parent = value(await vfs.stat(desktop))
  expect(await vfs.copyFile(empty, desktop)).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  expect(value(await vfs.stat(desktop))).toBe(parent)
})
