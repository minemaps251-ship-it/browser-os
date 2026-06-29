import {
  assertEqual,
  assertDifferent,
  assertMatch,
  assertLength,
  assertAtMost,
  assertIncludes,
} from './assertions'
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
export async function auditVfs(
  vfs: Vfs,
  checkpoint?: (snapshot: VfsAudit) => Promise<void>,
) {
  const nodes = new Map<NodeId, FileSystemNode>()
  const documents = new Map<NodeId, FileContent>()
  const contentIds = new Set<ContentId>()
  const pending = [
    { id: ROOT_NODE_ID, path: '/', parentId: null as NodeId | null },
  ]
  let bytes = 0
  while (pending.length) {
    const entry = pending.pop()!
    assertEqual(nodes.has(entry.id), false, 'cycle or duplicate child ID')
    const node = value(await vfs.stat(entry.id))
    assertEqual(node.id, entry.id)
    assertEqual(node.parentId, entry.parentId)
    assertEqual(node.name, node.name.normalize('NFC'))
    assertEqual(
      Number.isSafeInteger(node.metadataRevision) && node.metadataRevision > 0,
      true,
    )
    assertEqual(
      Number.isFinite(node.createdAt) && Number.isFinite(node.updatedAt),
      true,
    )
    assertEqual(value(await vfs.pathOf(node.id)), entry.path)
    assertEqual(value(await vfs.resolve(entry.path, ROOT_NODE_ID)), node.id)
    nodes.set(node.id, node)
    assertAtMost(nodes.size, VFS_LIMITS.maxNodes)
    if (node.kind === 'file') {
      assertEqual(contentIds.has(node.contentId), false)
      contentIds.add(node.contentId)
      const document = value(await vfs.readFile(node.id))
      assertEqual(document.node, node)
      assertEqual(document.contentRevision, node.contentRevision)
      assertEqual(
        Number.isSafeInteger(node.contentRevision) && node.contentRevision > 0,
        true,
      )
      assertEqual(document.content.encoding, 'utf-8')
      assertEqual(
        new TextEncoder().encode(document.content.text).byteLength,
        node.byteLength,
      )
      assertAtMost(node.byteLength, VFS_LIMITS.maxFileBytes)
      documents.set(node.id, document.content)
      bytes += node.byteLength
    } else {
      const children = value(await vfs.listDirectory(node.id))
      const names = children.map((child) => child.name)
      assertEqual(new Set(names).size, names.length)
      assertEqual(names, [...names].sort())
      for (const child of children)
        pending.push({
          id: child.id,
          parentId: node.id,
          path: `${entry.path === '/' ? '' : entry.path}/${child.name}`,
        })
    }
  }
  assertAtMost(bytes, VFS_LIMITS.maxTotalBytes)
  const snapshot = { nodes, documents, bytes }
  await checkpoint?.(snapshot)
  return snapshot
}

export interface VfsAudit {
  nodes: Map<NodeId, FileSystemNode>
  documents: Map<NodeId, FileContent>
  bytes: number
}
/** Events must describe the committed snapshot, with immutable and unique identities. */
function assertCommittedEvent(event: VfsChange, snapshot: VfsAudit) {
  assertEqual(Object.isFrozen(event), true, 'Event must be immutable')
  assertEqual(
    Boolean(event.operationId.trim() && event.originRequestId.trim()),
    true,
  )
  for (const ids of [
    event.metadataIds,
    event.contentIds,
    event.pathIds,
    event.directoryIds,
    event.removedIds,
  ]) {
    assertEqual(
      Object.isFrozen(ids),
      true,
      'Event identities must be immutable',
    )
    assertEqual(new Set(ids).size, ids.length, 'Duplicate event identities')
  }
  for (const id of [...event.metadataIds, ...event.pathIds])
    assertEqual(snapshot.nodes.has(id), true)
  for (const id of event.contentIds)
    assertEqual(snapshot.nodes.get(id)?.kind, 'file')
  for (const id of event.directoryIds)
    assertEqual(snapshot.nodes.get(id)?.kind, 'directory')
  for (const id of event.removedIds) assertEqual(snapshot.nodes.has(id), false)
}
interface ContractContext {
  vfs: Vfs
  docs: NodeId
  desktop: NodeId
  checkpoint?: (snapshot: VfsAudit) => Promise<void>
}
interface ContractCase {
  name: string
  run: (context: ContractContext) => Promise<void>
}
function defineCases() {
  const cases: ContractCase[] = []
  const add = (name: string, run: ContractCase['run']) => {
    cases.push({ name, run })
  }
  add(
    'touch is atomic for concurrent creation and preserves existing content identity',
    async (context) => {
      const { vfs, docs } = context
      const events: VfsChange[] = []
      const off = vfs.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      try {
        const touched = await Promise.all(
          Array.from({ length: 4 }, () => vfs.touchFile(docs, 'shared.txt')),
        )
        const ids = touched.map(value)
        assertEqual(new Set(ids).size, 1)
        const id = ids[0]
        const empty = value(await vfs.readFile(id))
        assertEqual(empty.content.text, '')
        assertEqual(empty.node.metadataRevision, 4)
        value(
          await vfs.writeFile(id, text('Keep 🌍'), {
            expectedContentRevision: empty.contentRevision,
            requestId: 'touch-contract',
          }),
        )
        const before = value(await vfs.readFile(id))
        const parent = value(await vfs.stat(docs))
        events.length = 0
        assertEqual(value(await vfs.touchFile(docs, 'shared.txt')), id)
        const after = value(await vfs.readFile(id))
        assertEqual(after.content, before.content)
        assertEqual(after.node.contentId, before.node.contentId)
        assertEqual(after.node.byteLength, before.node.byteLength)
        assertEqual(after.contentRevision, before.contentRevision)
        assertEqual(
          after.node.metadataRevision,
          before.node.metadataRevision + 1,
        )
        assertEqual(value(await vfs.stat(docs)), parent)
        assertLength(events, 1)
        assertEqual(events[0].contentIds, [])
        assertEqual(events[0].metadataIds, [id])
        const folder = value(await vfs.createDirectory(docs, 'folder'))
        events.length = 0
        assertMatch(await vfs.touchFile(docs, 'folder'), {
          ok: false,
          error: { code: 'NOT_FILE' },
        })
        assertMatch(await vfs.touchFile(folder, 'bad/name'), {
          ok: false,
          error: { code: 'INVALID_NAME' },
        })
        assertMatch(await vfs.touchFile('missing' as NodeId, 'file'), {
          ok: false,
          error: { code: 'NOT_FOUND' },
        })
        const system = value(await vfs.resolve('/system', ROOT_NODE_ID))
        assertMatch(await vfs.touchFile(system, 'file'), {
          ok: false,
          error: { code: 'PROTECTED' },
        })
        assertLength(events, 0)
        await auditVfs(vfs, context.checkpoint)
      } finally {
        off()
      }
    },
  )
  add(
    'composes create/write/rename/move/copy/remove with stable identity and coherent events',
    async (context) => {
      const events: VfsChange[] = []
      const unsubscribe = context.vfs.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      try {
        const folder = value(
          await context.vfs.createDirectory(context.docs, 'projects'),
        )
        const file = value(
          await context.vfs.createFile(folder, 'hello.txt', text('initial')),
        )
        const original = value(await context.vfs.readFile(file))
        const receipt = value(
          await context.vfs.writeFile(file, text('Привет 🌍'), {
            expectedContentRevision: 1,
            requestId: 'save-first',
          }),
        )
        value(await context.vfs.rename(file, 'Café.txt'))
        value(await context.vfs.move(folder, context.desktop, 'workspace'))
        assertEqual(
          value(await context.vfs.pathOf(file)),
          '/home/user/Desktop/workspace/Café.txt',
        )
        const ancestors = value(await context.vfs.ancestors(file))
        assertEqual(
          ancestors.map((node) => node.name),
          ['Café.txt', 'workspace', 'Desktop', 'user', 'home', ''],
        )
        assertEqual(
          ancestors.slice(0, 3).map((node) => node.id),
          [file, folder, context.desktop],
        )
        assertEqual(ancestors.at(-1)?.id, ROOT_NODE_ID)
        assertEqual(Object.isFrozen(ancestors), true)
        const moved = value(await context.vfs.readFile(file))
        assertEqual(moved.node.contentId, original.node.contentId)
        assertEqual(moved.contentRevision, receipt.contentRevision)
        assertEqual(moved.node.metadataRevision, 3)
        const copy = value(
          await context.vfs.copyFile(file, context.docs, 'copy.txt'),
        )
        const copied = value(await context.vfs.readFile(copy))
        assertDifferent(copied.node.contentId, original.node.contentId)
        assertEqual(copied.contentRevision, 1)
        value(
          await context.vfs.writeFile(copy, text('independent'), {
            expectedContentRevision: 1,
            requestId: 'save-copy',
          }),
        )
        value(await context.vfs.remove(folder, { recursive: true }))
        assertMatch(await context.vfs.readFile(file), {
          ok: false,
          error: { code: 'NOT_FOUND' },
        })
        assertMatch(await context.vfs.ancestors(file), {
          ok: false,
          error: { code: 'NOT_FOUND' },
        })
        assertEqual(
          value(await context.vfs.readFile(copy)).content.text,
          'independent',
        )
        assertEqual(original.content.text, 'initial')
        assertLength(events, 8)
        assertEqual(new Set(events.map((event) => event.operationId)).size, 8)
        assertMatch(events[2], {
          operationId: receipt.operationId,
          originRequestId: 'save-first',
          contentIds: [file],
        })
        assertIncludes(events[4].pathIds, [folder, file])
        assertIncludes(events[7].removedIds, [folder, file])
        await auditVfs(context.vfs, context.checkpoint)
      } finally {
        unsubscribe()
      }
    },
  )
  add(
    'allows exactly one stale-save winner and a fresh-revision retry',
    async (context) => {
      const file = value(
        await context.vfs.createFile(context.docs, 'race', text('initial')),
      )
      const results = await Promise.all(
        ['a', 'b'].map((requestId) =>
          context.vfs.writeFile(file, text(requestId), {
            expectedContentRevision: 1,
            requestId,
          }),
        ),
      )
      assertLength(
        results.filter((result) => result.ok),
        1,
      )
      assertMatch(
        results.find((result) => !result.ok),
        {
          error: { code: 'CONFLICT', expectedRevision: 1, actualRevision: 2 },
        },
      )
      const current = value(await context.vfs.readFile(file))
      value(
        await context.vfs.writeFile(file, text('retry'), {
          expectedContentRevision: current.contentRevision,
          requestId: 'retry',
        }),
      )
      assertEqual(value(await context.vfs.readFile(file)).contentRevision, 3)
      await auditVfs(context.vfs, context.checkpoint)
    },
  )
  add(
    'serializes NFC sibling collisions without partial metadata or content',
    async (context) => {
      const parent = value(await context.vfs.stat(context.docs))
      const results = await Promise.all([
        context.vfs.createFile(context.docs, 'Café', text('a')),
        context.vfs.createFile(context.docs, 'Cafe\u0301', text('b')),
      ])
      assertLength(
        results.filter((result) => result.ok),
        1,
      )
      assertMatch(
        results.find((result) => !result.ok),
        {
          error: { code: 'ALREADY_EXISTS' },
        },
      )
      assertEqual(
        value(await context.vfs.stat(context.docs)).metadataRevision,
        parent.metadataRevision + 1,
      )
      assertLength(value(await context.vfs.listDirectory(context.docs)), 1)
      await auditVfs(context.vfs, context.checkpoint)
    },
  )
  add(
    'preserves the complete observable tree and emits nothing on invalid operations',
    async (context) => {
      const folder = value(
        await context.vfs.createDirectory(context.docs, 'folder'),
      )
      const child = value(await context.vfs.createDirectory(folder, 'child'))
      const file = value(
        await context.vfs.createFile(child, 'file', text('keep')),
      )
      const before = await auditVfs(context.vfs, context.checkpoint)
      const events: VfsChange[] = []
      const unsubscribe = context.vfs.subscribe({ kind: 'all' }, (event) => {
        events.push(event)
      })
      try {
        for (const [result, code] of [
          [await context.vfs.move(folder, child), 'CYCLE'],
          [await context.vfs.remove(folder, { recursive: false }), 'NOT_EMPTY'],
          [
            await context.vfs.remove(ROOT_NODE_ID, { recursive: true }),
            'PROTECTED',
          ],
          [await context.vfs.rename(file, 'bad/name'), 'INVALID_NAME'],
          [await context.vfs.copyFile(folder, context.desktop), 'NOT_FILE'],
          [await context.vfs.move(file, file), 'NOT_DIRECTORY'],
          [
            await context.vfs.createDirectory(
              value(await context.vfs.resolve('/system', ROOT_NODE_ID)),
              'blocked',
            ),
            'PROTECTED',
          ],
        ] as const)
          assertMatch(result, { ok: false, error: { code } })
        value(await context.vfs.rename(file, 'file'))
        value(await context.vfs.move(file, child))
        assertEqual(events, [])
        assertEqual(await auditVfs(context.vfs, context.checkpoint), before)
      } finally {
        unsubscribe()
      }
    },
  )
  add(
    'handles copy/remove races without corrupting the winning copy or recreating the source',
    async (context) => {
      const file = value(
        await context.vfs.createFile(context.docs, 'file', text('keep')),
      )
      const [copied, removed] = await Promise.all([
        context.vfs.copyFile(file, context.desktop),
        context.vfs.remove(file, { recursive: false }),
      ])
      assertEqual(removed.ok, true)
      if (copied.ok)
        assertEqual(
          value(await context.vfs.readFile(copied.value)).content.text,
          'keep',
        )
      else assertEqual(copied.error.code, 'NOT_FOUND')
      assertMatch(
        await context.vfs.writeFile(file, text('stale'), {
          expectedContentRevision: 1,
          requestId: 'stale',
        }),
        { ok: false, error: { code: 'NOT_FOUND' } },
      )
      await auditVfs(context.vfs, context.checkpoint)
    },
  )
  add(
    'enforces per-file and aggregate byte limits and restores quota after deletion',
    async (context) => {
      const over = text('x'.repeat(VFS_LIMITS.maxFileBytes + 1))
      assertMatch(await context.vfs.createFile(context.docs, 'too-big', over), {
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
        files.push(
          value(await context.vfs.createFile(context.docs, `full-${i}`, full)),
        )
      const before = await auditVfs(context.vfs, context.checkpoint)
      assertMatch(await context.vfs.copyFile(files[0], context.desktop), {
        ok: false,
        error: { code: 'TOO_LARGE' },
      })
      assertMatch(
        await context.vfs.writeFile(files[0], over, {
          expectedContentRevision: 1,
          requestId: 'too-big',
        }),
        { ok: false, error: { code: 'TOO_LARGE' } },
      )
      assertEqual(await auditVfs(context.vfs, context.checkpoint), before)
      value(await context.vfs.remove(files[0], { recursive: false }))
      value(await context.vfs.copyFile(files[1], context.desktop))
      assertEqual(
        (await auditVfs(context.vfs, context.checkpoint)).bytes,
        VFS_LIMITS.maxTotalBytes,
      )
    },
  )
  add(
    'enforces node capacity and releases it after removing a subtree',
    async (context) => {
      const folder = value(
        await context.vfs.createDirectory(context.docs, 'capacity'),
      )
      for (let i = INITIAL_DIRECTORIES.length + 1; i < VFS_LIMITS.maxNodes; i++)
        value(await context.vfs.createDirectory(folder, `child-${i}`))
      assertMatch(
        await context.vfs.createFile(context.desktop, 'overflow', text('')),
        { ok: false, error: { code: 'TOO_LARGE' } },
      )
      value(await context.vfs.remove(folder, { recursive: true }))
      value(await context.vfs.createFile(context.desktop, 'after', text('')))
      await auditVfs(context.vfs, context.checkpoint)
    },
  )
  for (const seed of [7, 23, 101]) {
    add(
      `preserves tree/model invariants through generated operations (seed ${seed})`,
      async (context) => {
        let randomState = seed
        const choose = (size: number) => {
          randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0
          return (randomState >>> 8) % size
        }
        const folders = [
          value(await context.vfs.createDirectory(context.docs, 'Папка')),
          value(
            await context.vfs.createDirectory(context.desktop, 'Cafe\u0301'),
          ),
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
        const unsubscribe = context.vfs.subscribe({ kind: 'all' }, (event) => {
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
                await context.vfs.createFile(parentId, name, text(content)),
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
                  await context.vfs.writeFile(id, text(content), {
                    expectedContentRevision: current.contentRevision,
                    requestId: `seed-${seed}-${step}`,
                  }),
                )
                current.text = content
                current.contentRevision++
                current.metadataRevision++
              } else if (operation === 2) {
                value(await context.vfs.rename(id, name))
                current.name = name
                current.metadataRevision++
              } else if (operation === 3) {
                value(await context.vfs.move(id, parentId, name))
                current.parentId = parentId
                current.name = name
                current.metadataRevision++
              } else if (operation === 4) {
                const copied = value(
                  await context.vfs.copyFile(id, parentId, name),
                )
                model.set(copied, {
                  parentId,
                  name,
                  text: current.text,
                  contentRevision: 1,
                  metadataRevision: 1,
                })
              } else {
                value(await context.vfs.remove(id, { recursive: false }))
                model.delete(id)
                assertMatch(await context.vfs.stat(id), {
                  ok: false,
                  error: { code: 'NOT_FOUND' },
                })
              }
            }
            assertEqual(events.length, beforeEvents + 1)
            const snapshot = await auditVfs(context.vfs, context.checkpoint)
            assertCommittedEvent(events[beforeEvents], snapshot)
            assertEqual(
              new Set(events.map((event) => event.operationId)).size,
              events.length,
            )
            const actualFiles = [...snapshot.nodes.values()].filter(
              (node) => node.kind === 'file',
            )
            assertLength(actualFiles, model.size)
            for (const [id, expected] of model) {
              assertMatch(snapshot.nodes.get(id), {
                parentId: expected.parentId,
                name: expected.name,
                contentRevision: expected.contentRevision,
                metadataRevision: expected.metadataRevision,
              })
              assertEqual(snapshot.documents.get(id)?.text, expected.text)
            }
            if (step % 8 === 0 && model.size) {
              const [id, current] = [...model][0]
              assertMatch(
                await context.vfs.copyFile(id, current.parentId, current.name),
                { ok: false, error: { code: 'ALREADY_EXISTS' } },
              )
              assertEqual(
                await auditVfs(context.vfs, context.checkpoint),
                snapshot,
              )
              assertEqual(events.length, beforeEvents + 1)
            }
          }
          assertEqual([...exercised].sort(), [0, 1, 2, 3, 4, 5])
          for (const folder of folders)
            value(await context.vfs.remove(folder, { recursive: true }))
          assertEqual(
            (await auditVfs(context.vfs, context.checkpoint)).documents.size,
            0,
          )
        } finally {
          unsubscribe()
        }
      },
    )
  }
  return cases
}
export const vfsContractCases = defineCases()
export async function runVfsContractCase(
  name: string,
  fixture: VfsContractFixture,
  checkpoint?: ContractContext['checkpoint'],
) {
  try {
    const scenario = vfsContractCases.find((scenario) => scenario.name === name)
    if (!scenario) throw new Error('Unknown VFS contract case')
    const vfs = createVfsService(fixture.repository)
    const docs = value(await vfs.resolve('/home/user/Documents', ROOT_NODE_ID))
    const desktop = value(await vfs.resolve('/home/user/Desktop', ROOT_NODE_ID))
    await scenario.run({ vfs, docs, desktop, checkpoint })
    return await auditVfs(vfs, checkpoint)
  } finally {
    await fixture.dispose()
  }
}
