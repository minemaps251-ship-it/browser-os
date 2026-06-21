import { expect, it, vi } from 'vitest'
import { createInitialNodes } from '../filesystem/seed'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import type { ContentId, FileNode, NodeId } from '../filesystem/types'
import { decodeContent, decodeNode, validateMetadataSnapshot } from './records'
function seed() {
  let n = 0
  return [...createInitialNodes(1, () => `seed-${++n}` as NodeId)]
}
function file(): FileNode {
  return {
    id: 'file' as NodeId,
    parentId: seed().find((node) => node.name === 'Documents')!.id,
    name: 'Привет 🌍',
    kind: 'file',
    contentId: 'content' as ContentId,
    contentRevision: 2,
    metadataRevision: 3,
    byteLength: 4,
    mime: 'text/plain',
    createdAt: 1,
    updatedAt: 2,
    metadata: { protected: false },
  }
}
function audit(nodes: readonly unknown[], textBytes = 0) {
  return validateMetadataSnapshot(
    nodes,
    { key: 'schema', version: 1 },
    { key: 'totals', nodeCount: nodes.length, textBytes },
  )
}
it('decodes frozen explicit snapshots without keeping mutable input references', () => {
  const raw = { ...file(), extra: 'ignored', metadata: { protected: false } }
  const result = decodeNode(raw, raw.id)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('fixture')
  raw.metadata.protected = true
  expect(result.value.metadata.protected).toBe(false)
  expect(result.value).not.toHaveProperty('extra')
  expect(Object.isFrozen(result.value)).toBe(true)
  expect(Object.isFrozen(result.value.metadata)).toBe(true)
})
it.each([
  null,
  [],
  {},
  { ...file(), kind: 'link' },
  { ...file(), parentId: null },
  { ...file(), name: 'Cafe\u0301' },
  { ...file(), createdAt: NaN },
  { ...file(), metadataRevision: 0 },
  { ...file(), contentRevision: 1.5 },
  { ...file(), byteLength: -1 },
  { ...file(), byteLength: VFS_LIMITS.maxFileBytes + 1 },
  { ...file(), mime: '' },
  { ...file(), metadata: { protected: 'yes' } },
])('rejects malformed node metadata %#', (raw) => {
  expect(decodeNode(raw)).toMatchObject({
    ok: false,
    error: { code: 'CORRUPT_DATA' },
  })
})
it('checks expected identity and strict root invariants', () => {
  expect(decodeNode(file(), 'wrong' as NodeId).ok).toBe(false)
  const root = seed()[0]
  expect(decodeNode(root).ok).toBe(true)
  for (const changes of [
    { parentId: 'parent' },
    { name: 'root' },
    { metadata: { protected: false } },
  ])
    expect(decodeNode({ ...root, ...changes }).ok).toBe(false)
})
it('decodes text by record identity, encoding, Unicode and actual UTF-8 byte length', () => {
  const node = file()
  const raw = {
    id: node.contentId,
    content: { kind: 'text', encoding: 'utf-8', text: '😀' },
  }
  const result = decodeContent(raw, node)
  expect(result).toEqual({ ok: true, value: raw.content })
  expect(result.ok && Object.isFrozen(result.value)).toBe(true)
  for (const invalid of [
    undefined,
    { ...raw, id: 'other' },
    { ...raw, content: { ...raw.content, encoding: 'utf-16' } },
    { ...raw, content: { ...raw.content, text: '\uD800' } },
    { ...raw, content: { ...raw.content, text: 'different length' } },
  ])
    expect(decodeContent(invalid, node)).toMatchObject({
      ok: false,
      error: { code: 'CORRUPT_DATA', nodeId: node.id },
    })
})
it('accepts valid metadata/counters without reading file content', () => {
  const nodes = [...seed(), file()]
  expect(audit(nodes, 4).ok).toBe(true)
})
it.each([
  'missing root',
  'missing parent',
  'file parent',
  'cycle',
  'duplicate ID',
  'duplicate sibling',
  'shared content',
  'wrong counters',
  'wrong schema',
] as const)('rejects dataset corruption: %s', (kind) => {
  const original = file()
  let nodes: readonly unknown[] = [...seed(), original]
  if (kind === 'missing root') nodes = nodes.slice(1)
  if (kind === 'missing parent')
    nodes = [...seed(), { ...original, parentId: 'missing' }]
  if (kind === 'file parent')
    nodes = [
      ...nodes,
      {
        ...original,
        id: 'child',
        name: 'child',
        parentId: original.id,
        contentId: 'child-content',
      },
    ]
  if (kind === 'cycle')
    nodes = [
      ...seed(),
      { ...seed()[3], id: 'a', parentId: 'b', name: 'a' },
      { ...seed()[3], id: 'b', parentId: 'a', name: 'b' },
    ]
  if (kind === 'duplicate ID') nodes = [...nodes, original]
  if (kind === 'duplicate sibling')
    nodes = [...nodes, { ...original, id: 'other', contentId: 'other-content' }]
  if (kind === 'shared content')
    nodes = [...nodes, { ...original, id: 'other', name: 'other' }]
  const result =
    kind === 'wrong schema'
      ? validateMetadataSnapshot(
          nodes,
          { key: 'schema', version: 2 },
          { key: 'totals', nodeCount: nodes.length, textBytes: 4 },
        )
      : audit(nodes, kind === 'wrong counters' ? 0 : 4)
  expect(result).toMatchObject({ ok: false, error: { code: 'CORRUPT_DATA' } })
})
it('enforces aggregate metadata budgets and node limit', () => {
  const source = file()
  const nodes = [
    ...seed(),
    ...Array.from({ length: 11 }, (_, i) => ({
      ...source,
      id: `file-${i}`,
      contentId: `content-${i}`,
      name: `name-${i}`,
      byteLength: VFS_LIMITS.maxFileBytes,
    })),
  ]
  expect(audit(nodes, 11 * VFS_LIMITS.maxFileBytes).ok).toBe(false)
  expect(
    audit(Array.from({ length: VFS_LIMITS.maxNodes + 1 }, () => seed()[0])).ok,
  ).toBe(false)
})
it('iteratively validates a deep metadata tree without recursive stack use', () => {
  const nodes = seed()
  let parentId = ROOT_NODE_ID
  for (let i = nodes.length; i < VFS_LIMITS.maxNodes; i++) {
    const id = `deep-${i}` as NodeId
    nodes.push({ ...nodes[3], id, parentId, name: `level-${i}` })
    parentId = id
  }
  expect(audit(nodes).ok).toBe(true)
})

it('rejects oversized stored text before allocating its encoded byte buffer', () => {
  const encode = vi.spyOn(TextEncoder.prototype, 'encode')
  try {
    const node = file()
    const result = decodeContent(
      {
        id: node.contentId,
        content: {
          kind: 'text',
          encoding: 'utf-8',
          text: 'x'.repeat(VFS_LIMITS.maxFileBytes + 1),
        },
      },
      node,
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'CORRUPT_DATA' } })
    expect(encode).not.toHaveBeenCalled()
  } finally {
    encode.mockRestore()
  }
})
