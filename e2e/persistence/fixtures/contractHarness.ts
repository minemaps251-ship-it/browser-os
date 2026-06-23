import { open, snapshot, value } from './createHarness'
import { createIndexedDbVfsRepository } from '../../../src/core/storage/createRepository'
import { validateStoredMetadata } from '../../../src/core/storage/readRepository'
import { decodeNode, decodeContent } from '../../../src/core/storage/records'
import { createVfsService } from '../../../src/core/filesystem/service'
import { auditVfs, runVfsContractCase } from '../../../src/test/vfs/scenarios'
import type { VfsAudit } from '../../../src/test/vfs/scenarios'
import { assertEqual, assertMatch } from '../../../src/test/vfs/assertions'
import type { DatabaseConnection } from '../../../src/core/storage/types'
import type { ContentId, NodeId } from '../../../src/core/filesystem/types'
function summary(audit: VfsAudit) {
  return {
    nodes: [...audit.nodes.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    ),
    documents: [...audit.documents.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
    bytes: audit.bytes,
  }
}
async function physicalAudit(
  connection: DatabaseConnection,
  observable: VfsAudit,
) {
  value(await validateStoredMetadata(connection))
  const [nodes, contents, meta] = await snapshot(connection)
  const stored = new Map(
    nodes.map((raw) => {
      const node = value(decodeNode(raw))
      return [node.id, node] as const
    }),
  )
  assertEqual(stored, observable.nodes, 'Physical and observable nodes')
  assertEqual(
    contents.length,
    observable.documents.size,
    'Orphan or missing content records',
  )
  for (const node of observable.nodes.values()) {
    if (node.kind !== 'file') continue
    const raw = contents.find(
      (raw) =>
        raw !== null &&
        typeof raw === 'object' &&
        'id' in raw &&
        raw.id === node.contentId,
    )
    assertEqual(
      value(decodeContent(raw, node)),
      observable.documents.get(node.id),
      'Physical and observable contents',
    )
  }
  const totals = meta.find(
    (raw) =>
      raw !== null &&
      typeof raw === 'object' &&
      'key' in raw &&
      raw.key === 'totals',
  )
  assertMatch(totals, {
    nodeCount: observable.nodes.size,
    textBytes: observable.bytes,
  })
}
const api = {
  async run(name: string, scenario: string) {
    let active = await open(name),
      nodes = 0,
      contents = 0,
      operations = 0,
      time = 0,
      checks = 0,
      reopens = 0
    // Fixture-owned handle allows reopen checkpoints without losing subscriptions.
    const connection: DatabaseConnection = {
      get database() {
        return active.database
      },
      get closed() {
        return active.closed
      },
      close() {
        active.close()
      },
    }
    const repository = createIndexedDbVfsRepository(connection, {
      now: () => ++time,
      createNodeId: () => `contract-node-${++nodes}` as NodeId,
      createContentId: () => `contract-content-${++contents}` as ContentId,
      createOperationId: () => `contract-operation-${++operations}`,
    })
    const checkpoint = async (audit: VfsAudit) => {
      await physicalAudit(connection, audit)
      checks++
      if (checks % 8 === 0) {
        active.close()
        active = await open(name)
        reopens++
        await physicalAudit(connection, audit)
      }
    }
    const result = await runVfsContractCase(
      scenario,
      { repository, dispose: () => connection.close() },
      checkpoint,
    )
    return { snapshot: summary(result), checks, reopens }
  },
  async afterReload(name: string) {
    const connection = await open(name)
    try {
      return summary(
        await auditVfs(
          createVfsService(
            createIndexedDbVfsRepository(connection, {
              now: () => 0,
              createNodeId: () => {
                throw new Error('Read-only verification')
              },
              createContentId: () => {
                throw new Error('Read-only verification')
              },
              createOperationId: () => {
                throw new Error('Read-only verification')
              },
            }),
          ),
          (audit) => physicalAudit(connection, audit),
        ),
      )
    } finally {
      connection.close()
    }
  },
}
declare global {
  interface Window {
    idbContract: typeof api
  }
}
window.idbContract = api
