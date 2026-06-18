import { normalizeName } from './names'
import { ROOT_NODE_ID } from './policy'
import { createInitialNodes } from './seed'
import type { VfsReadRepository } from './repository'
import type { FileSystemNode, NodeId, VfsErrorCode, VfsResult } from './types'

function failure(code: VfsErrorCode, message: string, nodeId?: NodeId) {
  return { ok: false as const, error: { code, message, nodeId } }
}

/** Private immutable metadata snapshot. Write transactions will extend this adapter later. */
export function createMemoryVfsRepository(options: {
  now: () => number
  createNodeId: () => NodeId
  initialNodes?: readonly FileSystemNode[]
}): VfsResult<VfsReadRepository> {
  const input =
    options.initialNodes ??
    createInitialNodes(options.now(), options.createNodeId)
  const nodes = new Map<NodeId, FileSystemNode>()
  const children = new Map<NodeId, Map<string, NodeId>>()
  for (const node of input) {
    if (
      !node.id ||
      nodes.has(node.id) ||
      !Number.isFinite(node.createdAt) ||
      !Number.isFinite(node.updatedAt) ||
      !Number.isSafeInteger(node.metadataRevision) ||
      node.metadataRevision < 1 ||
      typeof node.metadata.protected !== 'boolean'
    )
      return failure(
        'CORRUPT_DATA',
        'Invalid or duplicate node metadata.',
        node.id,
      )
    if (node.id === ROOT_NODE_ID) {
      if (
        node.kind !== 'directory' ||
        node.parentId !== null ||
        node.name !== '' ||
        !node.metadata.protected
      )
        return failure('CORRUPT_DATA', 'Invalid filesystem root.', node.id)
    } else {
      const name = normalizeName(node.name)
      if (!name.ok || name.value !== node.name || node.parentId === null)
        return failure('CORRUPT_DATA', 'Invalid node name or parent.', node.id)
    }
    if (
      node.kind === 'file' &&
      (!node.contentId ||
        !Number.isSafeInteger(node.byteLength) ||
        node.byteLength < 0 ||
        !Number.isSafeInteger(node.contentRevision) ||
        node.contentRevision < 1)
    )
      return failure('CORRUPT_DATA', 'Invalid file metadata.', node.id)
    nodes.set(
      node.id,
      Object.freeze({ ...node, metadata: Object.freeze({ ...node.metadata }) }),
    )
  }
  if (!nodes.has(ROOT_NODE_ID))
    return failure('CORRUPT_DATA', 'Filesystem root is missing.')
  for (const node of nodes.values()) {
    if (node.parentId === null) continue
    if (nodes.get(node.parentId)?.kind !== 'directory')
      return failure(
        'CORRUPT_DATA',
        'Parent directory is missing or invalid.',
        node.id,
      )
    const siblings = children.get(node.parentId) ?? new Map<string, NodeId>()
    if (siblings.has(node.name))
      return failure('CORRUPT_DATA', 'Duplicate sibling name.', node.id)
    siblings.set(node.name, node.id)
    children.set(node.parentId, siblings)
    const seen = new Set<NodeId>()
    let current: FileSystemNode | undefined = node
    while (current && current.id !== ROOT_NODE_ID) {
      if (seen.has(current.id))
        return failure(
          'CORRUPT_DATA',
          'Filesystem contains a parent cycle.',
          node.id,
        )
      seen.add(current.id)
      current =
        current.parentId === null ? undefined : nodes.get(current.parentId)
    }
    if (!current)
      return failure('CORRUPT_DATA', 'Node is disconnected from root.', node.id)
  }
  function getNode(id: NodeId): VfsResult<FileSystemNode> {
    const node = nodes.get(id)
    return node
      ? { ok: true, value: node }
      : failure('NOT_FOUND', 'Node does not exist.', id)
  }
  const repository: VfsReadRepository = {
    async getNode(id) {
      return getNode(id)
    },
    async getChildren(id) {
      const result = getNode(id)
      if (!result.ok) return result
      if (result.value.kind !== 'directory')
        return failure('NOT_DIRECTORY', 'Node is not a directory.', id)
      const entries = Array.from(children.get(id)?.values() ?? [], (child) =>
        nodes.get(child)!,
      )
      // Stable case-sensitive UTF-16 ordering (no locale settings).
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      return { ok: true, value: Object.freeze(entries) }
    },
    async resolvePath(path, cwd) {
      let result = getNode(path.kind === 'absolute' ? ROOT_NODE_ID : cwd)
      if (!result.ok) return result
      if (result.value.kind !== 'directory')
        return failure(
          'NOT_DIRECTORY',
          'Working directory is not a directory.',
          result.value.id,
        )
      let current: FileSystemNode = result.value
      for (const segment of path.segments) {
        if (current.kind !== 'directory')
          return failure(
            'NOT_DIRECTORY',
            'Cannot traverse through a file.',
            current.id,
          )
        const nextId =
          segment.kind === 'current'
            ? current.id
            : segment.kind === 'parent'
              ? (current.parentId ?? ROOT_NODE_ID)
              : children.get(current.id)?.get(segment.name)
        if (!nextId)
          return failure(
            'NOT_FOUND',
            'Path component does not exist.',
            current.id,
          )
        result = getNode(nextId)
        if (!result.ok) return result
        current = result.value
      }
      if (path.requiresDirectory && current.kind !== 'directory')
        return failure(
          'NOT_DIRECTORY',
          'Path requires a directory.',
          current.id,
        )
      return { ok: true, value: current.id }
    },
    async pathOf(id) {
      const result = getNode(id)
      if (!result.ok) return result
      const names: string[] = []
      let current: FileSystemNode = result.value
      while (current.parentId !== null) {
        names.push(current.name)
        current = nodes.get(current.parentId)!
      }
      return { ok: true, value: '/' + names.reverse().join('/') }
    },
  }
  return { ok: true, value: repository }
}
