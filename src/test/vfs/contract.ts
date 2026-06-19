import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createVfsService } from '../../core/filesystem/service'
import {
  INITIAL_DIRECTORIES,
  ROOT_NODE_ID,
  VFS_LIMITS,
} from '../../core/filesystem/policy'
import type { VfsRepository } from '../../core/filesystem/repository'
import type {
  ContentId,
  FileContent,
  FileSystemNode,
  NodeId,
  VfsChange,
  VfsResult,
} from '../../core/filesystem/types'

export interface VfsContractFixture {
  repository: VfsRepository
  dispose: () => void | Promise<void>
}
export type VfsContractFactory = () =>
  VfsContractFixture | Promise<VfsContractFixture>
function value<T>(result: VfsResult<T>): T {
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}
const text = (text: string): FileContent => ({
  kind: 'text',
  encoding: 'utf-8',
  text,
})
type Vfs = ReturnType<typeof createVfsService>

/** Audit observable invariants, without inspecting backend indexes or counters. */
async function audit(vfs: Vfs) {
  const nodes = new Map<NodeId, FileSystemNode>()
  const documents = new Map<NodeId, FileContent>()
  const contentIds = new Set<ContentId>()
  const pending = [
    { id: ROOT_NODE_ID, path: '/', parentId: null as NodeId | null },
  ]
  let bytes = 0
  while (pending.length) {
    const entry = pending.pop()!
    expect(nodes.has(entry.id), 'cycle or duplicate child ID').toBe(false)
    const node = value(await vfs.stat(entry.id))
    expect(node.id).toBe(entry.id)
    expect(node.parentId).toBe(entry.parentId)
    expect(node.name).toBe(node.name.normalize('NFC'))
    expect(
      Number.isSafeInteger(node.metadataRevision) && node.metadataRevision > 0,
    ).toBe(true)
    expect(
      Number.isFinite(node.createdAt) && Number.isFinite(node.updatedAt),
    ).toBe(true)
    expect(value(await vfs.pathOf(node.id))).toBe(entry.path)
    expect(value(await vfs.resolve(entry.path, ROOT_NODE_ID))).toBe(node.id)
    nodes.set(node.id, node)
    expect(nodes.size).toBeLessThanOrEqual(VFS_LIMITS.maxNodes)
    if (node.kind === 'file') {
      expect(contentIds.has(node.contentId)).toBe(false)
      contentIds.add(node.contentId)
      const document = value(await vfs.readFile(node.id))
      expect(document.node).toEqual(node)
      expect(document.contentRevision).toBe(node.contentRevision)
      expect(
        Number.isSafeInteger(node.contentRevision) && node.contentRevision > 0,
      ).toBe(true)
      expect(document.content.encoding).toBe('utf-8')
      expect(new TextEncoder().encode(document.content.text).byteLength).toBe(
        node.byteLength,
      )
      expect(node.byteLength).toBeLessThanOrEqual(VFS_LIMITS.maxFileBytes)
      documents.set(node.id, document.content)
      bytes += node.byteLength
    } else {
      const children = value(await vfs.listDirectory(node.id))
      const names = children.map((child) => child.name)
      expect(new Set(names).size).toBe(names.length)
      expect(names).toEqual([...names].sort())
      for (const child of children)
        pending.push({
          id: child.id,
          parentId: node.id,
          path: `${entry.path === '/' ? '' : entry.path}/${child.name}`,
        })
    }
  }
  expect(bytes).toBeLessThanOrEqual(VFS_LIMITS.maxTotalBytes)
  return { nodes, documents, bytes }
}

/** Fresh seeded backend per case. Future durable adapters supply their own cleanup. */
export function defineVfsRepositoryContract(
  name: string,
  factory: VfsContractFactory,
) {
  describe(`${name} VFS repository contract`, () => {
    let fixture: VfsContractFixture | undefined
    let vfs: Vfs
    let docs: NodeId
    let desktop: NodeId
    beforeEach(async () => {
      fixture = await factory()
      vfs = createVfsService(fixture.repository)
      docs = value(await vfs.resolve('/home/user/Documents', ROOT_NODE_ID))
      desktop = value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID))
    })
    afterEach(async () => {
      await fixture?.dispose()
      fixture = undefined
    })
    it('composes create/write/rename/move/copy/remove with stable identity and coherent events', async () => {
      const events: VfsChange[] = []
      const unsubscribe = vfs.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      try {
        const folder = value(await vfs.createDirectory(docs, 'projects'))
        const file = value(
          await vfs.createFile(folder, 'hello.txt', text('initial')),
        )
        const original = value(await vfs.readFile(file))
        const receipt = value(
          await vfs.writeFile(file, text('Привет 🌍'), {
            expectedContentRevision: 1,
            requestId: 'save-first',
          }),
        )
        value(await vfs.rename(file, 'Café.txt'))
        value(await vfs.move(folder, desktop, 'workspace'))
        expect(value(await vfs.pathOf(file))).toBe(
          '/home/user/Desktop/workspace/Café.txt',
        )
        const moved = value(await vfs.readFile(file))
        expect(moved.node.contentId).toBe(original.node.contentId)
        expect(moved.contentRevision).toBe(receipt.contentRevision)
        expect(moved.node.metadataRevision).toBe(3)
        const copy = value(await vfs.copyFile(file, docs, 'copy.txt'))
        const copied = value(await vfs.readFile(copy))
        expect(copied.node.contentId).not.toBe(original.node.contentId)
        expect(copied.contentRevision).toBe(1)
        value(
          await vfs.writeFile(copy, text('independent'), {
            expectedContentRevision: 1,
            requestId: 'save-copy',
          }),
        )
        value(await vfs.remove(folder, { recursive: true }))
        expect(await vfs.readFile(file)).toMatchObject({
          ok: false,
          error: { code: 'NOT_FOUND' },
        })
        expect(value(await vfs.readFile(copy)).content.text).toBe('independent')
        expect(original.content.text).toBe('initial')
        expect(events).toHaveLength(8)
        expect(new Set(events.map((event) => event.operationId)).size).toBe(8)
        expect(events[2]).toMatchObject({
          operationId: receipt.operationId,
          originRequestId: 'save-first',
          contentIds: [file],
        })
        expect(events[4].pathIds).toEqual(
          expect.arrayContaining([folder, file]),
        )
        expect(events[7].removedIds).toEqual(
          expect.arrayContaining([folder, file]),
        )
        await audit(vfs)
      } finally {
        unsubscribe()
      }
    })
    it('allows exactly one stale-save winner and a fresh-revision retry', async () => {
      const file = value(await vfs.createFile(docs, 'race', text('initial')))
      const results = await Promise.all(
        ['a', 'b'].map((requestId) =>
          vfs.writeFile(file, text(requestId), {
            expectedContentRevision: 1,
            requestId,
          }),
        ),
      )
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.find((result) => !result.ok)).toMatchObject({
        error: { code: 'CONFLICT', expectedRevision: 1, actualRevision: 2 },
      })
      const current = value(await vfs.readFile(file))
      value(
        await vfs.writeFile(file, text('retry'), {
          expectedContentRevision: current.contentRevision,
          requestId: 'retry',
        }),
      )
      expect(value(await vfs.readFile(file)).contentRevision).toBe(3)
      await audit(vfs)
    })
    it('serializes NFC sibling collisions without partial metadata or content', async () => {
      const parent = value(await vfs.stat(docs))
      const results = await Promise.all([
        vfs.createFile(docs, 'Café', text('a')),
        vfs.createFile(docs, 'Cafe\u0301', text('b')),
      ])
      expect(results.filter((result) => result.ok)).toHaveLength(1)
      expect(results.find((result) => !result.ok)).toMatchObject({
        error: { code: 'ALREADY_EXISTS' },
      })
      expect(value(await vfs.stat(docs)).metadataRevision).toBe(
        parent.metadataRevision + 1,
      )
      expect(value(await vfs.listDirectory(docs))).toHaveLength(1)
      await audit(vfs)
    })
    it('preserves the complete observable tree and emits nothing on invalid operations', async () => {
      const folder = value(await vfs.createDirectory(docs, 'folder'))
      const child = value(await vfs.createDirectory(folder, 'child'))
      const file = value(await vfs.createFile(child, 'file', text('keep')))
      const before = await audit(vfs)
      const events: VfsChange[] = []
      const unsubscribe = vfs.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      try {
        for (const [result, code] of [
          [await vfs.move(folder, child), 'CYCLE'],
          [await vfs.remove(folder, { recursive: false }), 'NOT_EMPTY'],
          [await vfs.remove(ROOT_NODE_ID, { recursive: true }), 'PROTECTED'],
          [await vfs.rename(file, 'bad/name'), 'INVALID_NAME'],
          [await vfs.copyFile(folder, desktop), 'NOT_FILE'],
          [await vfs.move(file, file), 'NOT_DIRECTORY'],
          [
            await vfs.createDirectory(
              value(await vfs.resolve('/system', ROOT_NODE_ID)),
              'blocked',
            ),
            'PROTECTED',
          ],
        ] as const)
          expect(result).toMatchObject({ ok: false, error: { code } })
        value(await vfs.rename(file, 'file'))
        value(await vfs.move(file, child))
        expect(events).toEqual([])
        expect(await audit(vfs)).toEqual(before)
      } finally {
        unsubscribe()
      }
    })
    it('handles copy/remove races without corrupting the winning copy or recreating the source', async () => {
      const file = value(await vfs.createFile(docs, 'file', text('keep')))
      const [copied, removed] = await Promise.all([
        vfs.copyFile(file, desktop),
        vfs.remove(file, { recursive: false }),
      ])
      expect(removed.ok).toBe(true)
      if (copied.ok)
        expect(value(await vfs.readFile(copied.value)).content.text).toBe(
          'keep',
        )
      else expect(copied.error.code).toBe('NOT_FOUND')
      expect(
        await vfs.writeFile(file, text('stale'), {
          expectedContentRevision: 1,
          requestId: 'stale',
        }),
      ).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
      await audit(vfs)
    })
    it('enforces per-file and aggregate byte limits and restores quota after deletion', async () => {
      const over = text('x'.repeat(VFS_LIMITS.maxFileBytes + 1))
      expect(await vfs.createFile(docs, 'too-big', over)).toMatchObject({
        ok: false,
        error: { code: 'TOO_LARGE' },
      })
      const full = text('x'.repeat(VFS_LIMITS.maxFileBytes))
      const files: NodeId[] = []
      for (
        let i = 0;
        i < VFS_LIMITS.maxTotalBytes / VFS_LIMITS.maxFileBytes;
        i++
      )
        files.push(value(await vfs.createFile(docs, `full-${i}`, full)))
      const before = await audit(vfs)
      expect(await vfs.copyFile(files[0], desktop)).toMatchObject({
        ok: false,
        error: { code: 'TOO_LARGE' },
      })
      expect(
        await vfs.writeFile(files[0], over, {
          expectedContentRevision: 1,
          requestId: 'too-big',
        }),
      ).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
      expect(await audit(vfs)).toEqual(before)
      value(await vfs.remove(files[0], { recursive: false }))
      value(await vfs.copyFile(files[1], desktop))
      expect((await audit(vfs)).bytes).toBe(VFS_LIMITS.maxTotalBytes)
    })
    it('enforces node capacity and releases it after removing a subtree', async () => {
      const folder = value(await vfs.createDirectory(docs, 'capacity'))
      for (let i = INITIAL_DIRECTORIES.length + 1; i < VFS_LIMITS.maxNodes; i++)
        value(await vfs.createDirectory(folder, `child-${i}`))
      expect(await vfs.createFile(desktop, 'overflow', text(''))).toMatchObject(
        { ok: false, error: { code: 'TOO_LARGE' } },
      )
      value(await vfs.remove(folder, { recursive: true }))
      value(await vfs.createFile(desktop, 'after', text('')))
      await audit(vfs)
    })
    for (const seed of [7, 23, 101]) {
      it(`preserves tree/model invariants through generated operations (seed ${seed})`, async () => {
        let randomState = seed
        const choose = (size: number) => {
          randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
          return (randomState >>> 8) % size
        }
        const folders = [
          value(await vfs.createDirectory(docs, 'Папка')),
          value(await vfs.createDirectory(desktop, 'Cafe\u0301')),
        ]
        const model = new Map<
          NodeId,
          {
            parentId: NodeId
            name: string
            text: string
            contentRevision: number
            metadataRevision: number
          }
        >()
        const exercised = new Set<number>()
        let sequence = 0
        const events: VfsChange[] = []
        const unsubscribe = vfs.subscribe({ kind: 'all' }, (event) => {
          events.push(event)
        })
        try {
          for (let step = 0; step < 48; step++) {
            const ids = [...model.keys()]
            const operation = ids.length ? choose(6) : 0
            exercised.add(operation)
            const name =
              [' spaced name ', 'Café', '😀', '__proto__', '~%2F'][choose(5)] +
              `-${sequence++}`
            const parentId = folders[choose(folders.length)]
            const beforeEvents = events.length
            const id = ids.length ? ids[choose(ids.length)] : undefined
            if (operation === 0 || id === undefined) {
              const content = `создано ${step} 🌍`
              const created = value(
                await vfs.createFile(parentId, name, text(content)),
              )
              model.set(created, {
                parentId,
                name,
                text: content,
                contentRevision: 1,
                metadataRevision: 1,
              })
            } else {
              const current = model.get(id)!
              if (operation === 1) {
                const content = `запись ${seed}/${step}`
                value(
                  await vfs.writeFile(id, text(content), {
                    expectedContentRevision: current.contentRevision,
                    requestId: `seed-${seed}-${step}`,
                  }),
                )
                current.text = content
                current.contentRevision++
                current.metadataRevision++
              } else if (operation === 2) {
                value(await vfs.rename(id, name))
                current.name = name
                current.metadataRevision++
              } else if (operation === 3) {
                value(await vfs.move(id, parentId, name))
                current.parentId = parentId
                current.name = name
                current.metadataRevision++
              } else if (operation === 4) {
                const copied = value(await vfs.copyFile(id, parentId, name))
                model.set(copied, {
                  parentId,
                  name,
                  text: current.text,
                  contentRevision: 1,
                  metadataRevision: 1,
                })
              } else {
                value(await vfs.remove(id, { recursive: false }))
                model.delete(id)
                expect(await vfs.stat(id)).toMatchObject({
                  ok: false,
                  error: { code: 'NOT_FOUND' },
                })
              }
            }
            expect(events.length).toBe(beforeEvents + 1)
            const snapshot = await audit(vfs)
            const actualFiles = [...snapshot.nodes.values()].filter(
              (node) => node.kind === 'file',
            )
            expect(actualFiles).toHaveLength(model.size)
            for (const [id, expected] of model) {
              expect(snapshot.nodes.get(id)).toMatchObject({
                parentId: expected.parentId,
                name: expected.name,
                contentRevision: expected.contentRevision,
                metadataRevision: expected.metadataRevision,
              })
              expect(snapshot.documents.get(id)?.text).toBe(expected.text)
            }
            if (step % 8 === 0 && model.size) {
              const [id, current] = [...model][0]
              expect(
                await vfs.copyFile(id, current.parentId, current.name),
              ).toMatchObject({ ok: false, error: { code: 'ALREADY_EXISTS' } })
              expect(await audit(vfs)).toEqual(snapshot)
              expect(events.length).toBe(beforeEvents + 1)
            }
          }
          expect([...exercised].sort()).toEqual([0, 1, 2, 3, 4, 5])
          for (const folder of folders)
            value(await vfs.remove(folder, { recursive: true }))
          expect((await audit(vfs)).documents.size).toBe(0)
        } finally {
          unsubscribe()
        }
      })
    }
  })
}
