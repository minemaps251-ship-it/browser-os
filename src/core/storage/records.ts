import { normalizeName } from '../filesystem/names'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import { prepareTextContent } from '../filesystem/content'
import type {
  ContentId,
  FileContent,
  FileNode,
  FileSystemNode,
  NodeId,
  VfsResult,
} from '../filesystem/types'
import { DATABASE_VERSION } from './schema'
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function positiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
export function corrupt(
  message: string,
  nodeId?: NodeId,
): Extract<VfsResult<never>, { ok: false }> {
  return { ok: false, error: { code: 'CORRUPT_DATA', message, nodeId } }
}
export function decodeNode(
  raw: unknown,
  expectedId?: NodeId,
): VfsResult<FileSystemNode> {
  if (
    !record(raw) ||
    typeof raw.id !== 'string' ||
    !raw.id ||
    (expectedId !== undefined && raw.id !== expectedId) ||
    (raw.kind !== 'file' && raw.kind !== 'directory') ||
    typeof raw.name !== 'string' ||
    raw.name.length > VFS_LIMITS.maxNameCodePoints * 2 ||
    !positiveRevision(raw.metadataRevision) ||
    typeof raw.createdAt !== 'number' ||
    !Number.isFinite(raw.createdAt) ||
    typeof raw.updatedAt !== 'number' ||
    !Number.isFinite(raw.updatedAt) ||
    !record(raw.metadata) ||
    typeof raw.metadata.protected !== 'boolean'
  )
    return corrupt('Invalid node metadata.', expectedId)
  const id = raw.id as NodeId
  if (id === ROOT_NODE_ID) {
    if (
      raw.kind !== 'directory' ||
      raw.parentId !== null ||
      raw.name !== '' ||
      !raw.metadata.protected
    )
      return corrupt('Invalid filesystem root.', id)
  } else {
    const name = normalizeName(raw.name)
    if (
      !name.ok ||
      name.value !== raw.name ||
      typeof raw.parentId !== 'string' ||
      !raw.parentId
    )
      return corrupt('Invalid node name or parent.', id)
  }
  const base = {
    id,
    name: raw.name,
    parentId: raw.parentId as NodeId | null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    metadataRevision: raw.metadataRevision,
    metadata: Object.freeze({ protected: raw.metadata.protected }),
  }
  if (raw.kind === 'directory')
    return { ok: true, value: Object.freeze({ ...base, kind: 'directory' }) }
  if (
    typeof raw.contentId !== 'string' ||
    !raw.contentId ||
    !positiveRevision(raw.contentRevision) ||
    typeof raw.byteLength !== 'number' ||
    !Number.isSafeInteger(raw.byteLength) ||
    raw.byteLength < 0 ||
    raw.byteLength > VFS_LIMITS.maxFileBytes ||
    typeof raw.mime !== 'string' ||
    !raw.mime
  )
    return corrupt('Invalid file metadata.', id)
  return {
    ok: true,
    value: Object.freeze({
      ...base,
      parentId: raw.parentId as NodeId,
      kind: 'file',
      mime: raw.mime,
      contentId: raw.contentId as ContentId,
      contentRevision: raw.contentRevision,
      byteLength: raw.byteLength,
    }),
  }
}
export function decodeContent(
  raw: unknown,
  node: FileNode,
): VfsResult<FileContent> {
  if (
    !record(raw) ||
    raw.id !== node.contentId ||
    !record(raw.content) ||
    raw.content.kind !== 'text' ||
    raw.content.encoding !== 'utf-8' ||
    typeof raw.content.text !== 'string' ||
    raw.content.text.length > node.byteLength
  )
    return corrupt('File content is missing or invalid.', node.id)
  const result = prepareTextContent({
    kind: 'text',
    encoding: 'utf-8',
    text: raw.content.text,
  })
  if (!result.ok || result.value.byteLength !== node.byteLength)
    return corrupt('File content does not match its metadata.', node.id)
  return { ok: true, value: result.value.content }
}

/** Boot audit only: metadata counters/connectivity without fetching all texts. */
export function validateMetadataSnapshot(
  records: readonly unknown[],
  schema: unknown,
  totals: unknown,
): VfsResult<void> {
  if (
    records.length > VFS_LIMITS.maxNodes ||
    !record(schema) ||
    schema.key !== 'schema' ||
    schema.version !== DATABASE_VERSION ||
    !record(totals) ||
    totals.key !== 'totals'
  )
    return corrupt('Invalid schema, counters or dataset size.')
  const nodes = new Map<NodeId, FileSystemNode>()
  const siblings = new Map<NodeId, Set<string>>()
  const contents = new Set<ContentId>()
  let bytes = 0
  for (const raw of records) {
    const decoded = decodeNode(raw)
    if (!decoded.ok) return decoded
    const node = decoded.value
    if (nodes.has(node.id)) return corrupt('Duplicate node identity.', node.id)
    nodes.set(node.id, node)
    if (node.parentId !== null) {
      const names = siblings.get(node.parentId) ?? new Set<string>()
      if (names.has(node.name))
        return corrupt('Duplicate sibling name.', node.id)
      names.add(node.name)
      siblings.set(node.parentId, names)
    }
    if (node.kind === 'file') {
      if (contents.has(node.contentId))
        return corrupt('Shared file content identity.', node.id)
      contents.add(node.contentId)
      bytes += node.byteLength
    }
  }
  if (!nodes.has(ROOT_NODE_ID))
    return corrupt('Filesystem root is missing.', ROOT_NODE_ID)
  const connected = new Set<NodeId>([ROOT_NODE_ID])
  for (const node of nodes.values()) {
    const seen = new Set<NodeId>()
    let current = node
    while (!connected.has(current.id)) {
      if (seen.has(current.id))
        return corrupt('Parent cycle detected.', node.id)
      seen.add(current.id)
      const parent =
        current.parentId === null ? undefined : nodes.get(current.parentId)
      if (!parent || parent.kind !== 'directory')
        return corrupt('Parent directory is missing or invalid.', current.id)
      current = parent
    }
    for (const id of seen) connected.add(id)
  }
  if (
    bytes > VFS_LIMITS.maxTotalBytes ||
    totals.nodeCount !== nodes.size ||
    totals.textBytes !== bytes
  )
    return corrupt('Filesystem counters or byte budget are inconsistent.')
  return { ok: true, value: undefined }
}
