import { createInitialNodes } from '../filesystem/seed'
import type { NodeId } from '../filesystem/types'
import type { SchemaRecord, ThemeSettingRecord, TotalsRecord } from './types'
export const DATABASE_VERSION = 1
export const DATABASE_NAME = 'browser-os'
export const STORES = Object.freeze({
  nodes: 'nodes',
  contents: 'contents',
  meta: 'meta',
  settings: 'settings',
})
export const INDEXES = Object.freeze({
  parent: 'byParent',
  sibling: 'bySibling',
})

/** Runs inside the initial versionchange transaction; never repairs an existing DB. */
export function initializeSchema(
  database: IDBDatabase,
  now: () => number,
  createNodeId: () => NodeId,
) {
  const timestamp = now()
  if (!Number.isFinite(timestamp)) throw new Error('Invalid seed timestamp')
  const nodes = createInitialNodes(timestamp, createNodeId)
  if (
    new Set(nodes.map((node) => node.id)).size !== nodes.length ||
    nodes.some((node) => !node.id)
  )
    throw new Error('Invalid seed identities')
  const nodeStore = database.createObjectStore(STORES.nodes, { keyPath: 'id' })
  nodeStore.createIndex(INDEXES.parent, 'parentId')
  nodeStore.createIndex(INDEXES.sibling, ['parentId', 'name'], { unique: true })
  database.createObjectStore(STORES.contents, { keyPath: 'id' })
  const meta = database.createObjectStore(STORES.meta, { keyPath: 'key' })
  const settings = database.createObjectStore(STORES.settings, {
    keyPath: 'key',
  })
  for (const node of nodes) nodeStore.add(node)
  meta.add({ key: 'schema', version: DATABASE_VERSION } satisfies SchemaRecord)
  meta.add({
    key: 'totals',
    nodeCount: nodes.length,
    textBytes: 0,
  } satisfies TotalsRecord)
  settings.add({
    key: 'theme',
    value: 'system',
    schemaVersion: 1,
  } satisfies ThemeSettingRecord)
}

export function validateSchema(database: IDBDatabase): boolean {
  const names = Object.values(STORES)
  if (
    database.version !== DATABASE_VERSION ||
    database.objectStoreNames.length !== names.length ||
    names.some((name) => !database.objectStoreNames.contains(name))
  )
    return false
  const transaction = database.transaction(names, 'readonly')
  const nodes = transaction.objectStore(STORES.nodes)
  if (
    nodes.keyPath !== 'id' ||
    nodes.autoIncrement ||
    nodes.indexNames.length !== 2 ||
    !nodes.indexNames.contains(INDEXES.parent) ||
    !nodes.indexNames.contains(INDEXES.sibling)
  )
    return false
  const parent = nodes.index(INDEXES.parent)
  const sibling = nodes.index(INDEXES.sibling)
  if (
    parent.keyPath !== 'parentId' ||
    parent.unique ||
    parent.multiEntry ||
    sibling.unique !== true ||
    sibling.multiEntry ||
    JSON.stringify(sibling.keyPath) !== JSON.stringify(['parentId', 'name'])
  )
    return false
  return names
    .filter((name) => name !== STORES.nodes)
    .every((name) => {
      const store = transaction.objectStore(name)
      return (
        store.keyPath === (name === STORES.contents ? 'id' : 'key') &&
        !store.autoIncrement &&
        store.indexNames.length === 0
      )
    })
}
