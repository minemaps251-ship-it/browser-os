import { expect, it } from 'vitest'
import { createMemoryVfsRepository } from './memoryRepository'
import { createVfsService } from './service'
import { createInitialNodes } from './seed'
import { VFS_LIMITS } from './policy'
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
function setup(
  nodes?: readonly FileSystemNode[],
  contents?: readonly StoredFileContent[],
) {
  let n = 0
  let c = 0
  let op = 0
  const options = {
    now: () => 1,
    createNodeId: () => `node-${++n}` as NodeId,
    createContentId: () => `content-${++c}` as ContentId,
    createOperationId: () => `op-${++op}`,
    initialNodes: nodes,
    initialContents: contents,
  }
  const repo = value(createMemoryVfsRepository(options))
  const vfs = createVfsService(repo)
  return { vfs, options }
}
async function fixture() {
  const { vfs, options } = setup()
  const docs = value(
    await vfs.resolve('/home/user/Documents', 'unused' as NodeId),
  )
  const id = value(await vfs.createFile(docs, 'note.txt', text('original')))
  return { vfs, options, docs, id }
}
const request = (expectedContentRevision = 1, requestId = 'save-1') => ({
  expectedContentRevision,
  requestId,
})

it('updates text/bytes/revisions atomically with receipt and stable identities', async () => {
  const { vfs, options, docs, id } = await fixture()
  const before = value(await vfs.readFile(id))
  const parent = value(await vfs.stat(docs))
  options.now = () => 2
  const receipt = value(await vfs.writeFile(id, text('Привет 😀'), request()))
  const after = value(await vfs.readFile(id))
  expect(receipt).toEqual({
    contentRevision: 2,
    operationId: 'op-2',
    originRequestId: 'save-1',
  })
  expect(after.node).toMatchObject({
    id,
    contentId: before.node.contentId,
    byteLength: 17,
    contentRevision: 2,
    metadataRevision: 2,
    updatedAt: 2,
  })
  expect(after.node.createdAt).toBe(before.node.createdAt)
  expect(after.content).toEqual(text('Привет 😀'))
  expect(value(await vfs.stat(docs))).toBe(parent)
  expect(Object.isFrozen(after)).toBe(true)
  expect(Object.isFrozen(receipt)).toBe(true)
  expect(before.content.text).toBe('original')
  expect(before.node.contentRevision).toBe(1)
})
it('one concurrent save wins and the stale one cannot overwrite it', async () => {
  const { vfs, id } = await fixture()
  const [first, second] = await Promise.all([
    vfs.writeFile(id, text('first'), request(1, 'a')),
    vfs.writeFile(id, text('second'), request(1, 'b')),
  ])
  expect(first.ok).toBe(true)
  expect(second).toMatchObject({
    ok: false,
    error: {
      code: 'CONFLICT',
      nodeId: id,
      expectedRevision: 1,
      actualRevision: 2,
    },
  })
  expect(value(await vfs.readFile(id)).content.text).toBe('first')
  expect(
    value(await vfs.writeFile(id, text('retry'), request(2, 'retry')))
      .contentRevision,
  ).toBe(3)
})
it('advances every accepted save, including identical text; stale identical save still conflicts', async () => {
  const { vfs, id } = await fixture()
  expect(
    value(await vfs.writeFile(id, text('original'), request())).contentRevision,
  ).toBe(2)
  expect(await vfs.writeFile(id, text('original'), request())).toMatchObject({
    ok: false,
    error: { code: 'CONFLICT' },
  })
})
it('different files save independently and contents do not alias caller input', async () => {
  const { vfs, docs, id } = await fixture()
  const other = value(await vfs.createFile(docs, 'other', text('old')))
  const input = text('captured')
  const results = await Promise.all([
    vfs.writeFile(id, input, request(1, 'a')),
    vfs.writeFile(other, text('other'), request(1, 'b')),
  ])
  Object.assign(input, { text: 'external' })
  expect(results.every((r) => r.ok)).toBe(true)
  expect(value(await vfs.readFile(id)).content.text).toBe('captured')
  expect(value(await vfs.readFile(other)).content.text).toBe('other')
})
it.each([0, -1, 1.5, NaN, Infinity])(
  'rejects invalid expected revision %s without touching data',
  async (expected) => {
    const { vfs, id } = await fixture()
    const before = value(await vfs.readFile(id))
    expect(
      await vfs.writeFile(id, text('bad'), request(expected)),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(value(await vfs.readFile(id)).node).toBe(before.node)
  },
)
it('rejects empty request IDs and malformed Unicode content', async () => {
  const { vfs, id } = await fixture()
  expect(await vfs.writeFile(id, text('bad'), request(1, ' '))).toMatchObject({
    ok: false,
    error: { code: 'INVALID_REQUEST' },
  })
  expect(await vfs.writeFile(id, text('\ud800'), request())).toMatchObject({
    ok: false,
    error: { code: 'INVALID_CONTENT' },
  })
  expect(value(await vfs.readFile(id)).content.text).toBe('original')
})
it('rejects directory/missing files without implicit recreation', async () => {
  const { vfs, docs } = await fixture()
  expect(await vfs.writeFile(docs, text('bad'), request())).toMatchObject({
    ok: false,
    error: { code: 'NOT_FILE' },
  })
  expect(
    await vfs.writeFile('missing' as NodeId, text('bad'), request()),
  ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
})
it.each(['protected', 'system'] as const)(
  'rejects %s file writes',
  async (kind) => {
    let n = 0
    const nodes = createInitialNodes(1, () => `seed-${++n}` as NodeId)
    const parent = nodes.find(
      (node) => node.name === (kind === 'system' ? 'system' : 'Documents'),
    )!
    const file = {
      id: 'fixture-file' as NodeId,
      parentId: parent.id,
      kind: 'file' as const,
      name: 'readonly',
      createdAt: 1,
      updatedAt: 1,
      metadataRevision: 1,
      metadata: { protected: kind === 'protected' },
      mime: 'text/plain',
      byteLength: 3,
      contentId: 'fixture-content' as ContentId,
      contentRevision: 1,
    }
    const { vfs } = setup(
      [...nodes, file],
      [{ id: file.contentId, content: text('old') }],
    )
    expect(await vfs.writeFile(file.id, text('bad'), request())).toMatchObject({
      ok: false,
      error: { code: 'PROTECTED' },
    })
    expect(value(await vfs.readFile(file.id)).content.text).toBe('old')
  },
)
it('enforces UTF-8 file limit and retains accepted snapshot on overflow', async () => {
  const { vfs, id } = await fixture()
  const payload = '😀'.repeat(VFS_LIMITS.maxFileBytes / 4)
  expect((await vfs.writeFile(id, text(payload), request())).ok).toBe(true)
  const before = value(await vfs.readFile(id))
  expect(
    await vfs.writeFile(id, text(payload + 'a'), request(2)),
  ).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
  expect(value(await vfs.readFile(id)).node).toBe(before.node)
  expect(
    value(await vfs.writeFile(id, text(''), request(2))).contentRevision,
  ).toBe(3)
  expect(value(await vfs.readFile(id)).node.byteLength).toBe(0)
})
it('uses byte delta for total budget; shrink frees space, failed growth does not consume it', async () => {
  const { vfs, docs } = await fixture()
  const files: NodeId[] = []
  const payload = 'a'.repeat(VFS_LIMITS.maxFileBytes)
  // The fixture note uses 8 bytes: leave exactly the aggregate boundary.
  for (let i = 0; i < 10; i++)
    files.push(
      value(
        await vfs.createFile(
          docs,
          `large-${i}`,
          text(i === 9 ? payload.slice(8) : payload),
        ),
      ),
    )
  const empty = value(await vfs.createFile(docs, 'empty', text('')))
  expect(await vfs.writeFile(empty, text('a'), request())).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
  expect(value(await vfs.readFile(empty)).node.contentRevision).toBe(1)
  expect((await vfs.writeFile(files[0], text(''), request())).ok).toBe(true)
  expect((await vfs.writeFile(empty, text(payload), request())).ok).toBe(true)
  expect(await vfs.createFile(docs, 'no-room', text('a'))).toMatchObject({
    ok: false,
    error: { code: 'TOO_LARGE' },
  })
})
it.each(['operation', 'time', 'invalid-time'] as const)(
  'rolls back %s failure and permits retry',
  async (phase) => {
    const { vfs, options, id } = await fixture()
    const before = value(await vfs.readFile(id))
    if (phase === 'operation')
      options.createOperationId = () => {
        throw new Error('injected')
      }
    if (phase === 'time')
      options.now = () => {
        throw new Error('injected')
      }
    if (phase === 'invalid-time') options.now = () => NaN
    const result = await vfs.writeFile(id, text('bad'), request())
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: phase === 'invalid-time' ? 'CORRUPT_DATA' : 'STORAGE_UNAVAILABLE',
      },
    })
    const after = value(await vfs.readFile(id))
    expect(after.node).toBe(before.node)
    expect(after.content).toBe(before.content)
    options.createOperationId = () => 'recovered'
    options.now = () => 2
    expect(
      value(await vfs.writeFile(id, text('good'), request())).contentRevision,
    ).toBe(2)
  },
)
