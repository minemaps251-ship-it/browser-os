import { normalizeName } from './names'
import { ROOT_NODE_ID, VFS_LIMITS } from './policy'
import { createInitialNodes } from './seed'
import { prepareTextContent } from './content'
import type { VfsRepository } from './repository'
import type {
  FileSystemNode,
  NodeId,
  VfsErrorCode,
  VfsResult,
  ContentId,
  FileContent,
  StoredFileContent,
} from './types'

function failure(code: VfsErrorCode, message: string, nodeId?: NodeId) {
  return { ok: false as const, error: { code, message, nodeId } }
}

/** Prepare a new snapshot, then publish metadata/content/indexes/counters together. */
export function createMemoryVfsRepository(options: {
  now: () => number
  createNodeId: () => NodeId
  createContentId: () => ContentId
  createOperationId: () => string
  initialContents?: readonly StoredFileContent[]
  initialNodes?: readonly FileSystemNode[]
}): VfsResult<VfsRepository> {
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
  const contents = new Map<ContentId, FileContent>()
  for (const record of options.initialContents ?? []) {
    const prepared = prepareTextContent(record.content)
    if (!record.id || contents.has(record.id) || !prepared.ok)
      return failure('CORRUPT_DATA', 'Invalid or duplicate file content.')
    contents.set(record.id, prepared.value.content)
  }
  let totalBytes = 0
  const referenced = new Set<ContentId>()
  for (const node of nodes.values()) {
    if (node.kind !== 'file') continue
    const content = contents.get(node.contentId)
    if (!content || referenced.has(node.contentId))
      return failure('CORRUPT_DATA', 'Missing or shared file content.', node.id)
    const prepared = prepareTextContent(content)
    if (
      !prepared.ok ||
      prepared.value.byteLength !== node.byteLength ||
      node.byteLength > VFS_LIMITS.maxFileBytes
    )
      return failure(
        'CORRUPT_DATA',
        'File size does not match valid content.',
        node.id,
      )
    referenced.add(node.contentId)
    totalBytes += node.byteLength
  }
  if (
    referenced.size !== contents.size ||
    totalBytes > VFS_LIMITS.maxTotalBytes ||
    nodes.size > VFS_LIMITS.maxNodes
  )
    return failure('CORRUPT_DATA', 'Orphan content or dataset exceeds limits.')
  let state = { nodes, children, contents, totalBytes }

  function inSystem(id: NodeId) {
    const systemId = state.children.get(ROOT_NODE_ID)?.get('system')
    let ancestor = state.nodes.get(id)
    while (ancestor) {
      if (ancestor.id === systemId) return true
      ancestor =
        ancestor.parentId === null
          ? undefined
          : state.nodes.get(ancestor.parentId)
    }
    return false
  }

  function create(
    parentId: NodeId,
    name: string,
    content?: FileContent,
  ): VfsResult<NodeId> {
    const parent = state.nodes.get(parentId)
    if (!parent) return failure('NOT_FOUND', 'Parent does not exist.', parentId)
    if (parent.kind !== 'directory')
      return failure('NOT_DIRECTORY', 'Parent is not a directory.', parentId)
    if (inSystem(parentId))
      return failure(
        'PROTECTED',
        'The system directory is read-only.',
        parentId,
      )
    const normalized = normalizeName(name)
    if (!normalized.ok) return normalized
    const siblings = state.children.get(parentId)
    if (siblings?.has(normalized.value))
      return failure(
        'ALREADY_EXISTS',
        'A sibling with that name already exists.',
        parentId,
      )
    if (state.nodes.size >= VFS_LIMITS.maxNodes)
      return failure('TOO_LARGE', 'Node count limit reached.')
    const prepared =
      content === undefined ? undefined : prepareTextContent(content)
    if (prepared && !prepared.ok) return prepared
    const text = prepared?.ok ? prepared.value : undefined
    const bytes = text?.byteLength ?? 0
    if (
      bytes > VFS_LIMITS.maxFileBytes ||
      state.totalBytes + bytes > VFS_LIMITS.maxTotalBytes
    )
      return failure('TOO_LARGE', 'File or total text size limit exceeded.')
    if (parent.metadataRevision >= Number.MAX_SAFE_INTEGER)
      return failure(
        'CORRUPT_DATA',
        'Parent revision cannot advance.',
        parentId,
      )
    // Dependencies are invoked before staging/publishing, so failure cannot leak a node.
    try {
      const id = options.createNodeId()
      const contentId = text ? options.createContentId() : undefined
      const now = options.now()
      if (
        !id ||
        state.nodes.has(id) ||
        !Number.isFinite(now) ||
        (text && (!contentId || state.contents.has(contentId)))
      )
        return failure(
          'CORRUPT_DATA',
          'Generated identity or timestamp is invalid.',
        )
      const base = {
        id,
        parentId,
        name: normalized.value,
        createdAt: now,
        updatedAt: now,
        metadataRevision: 1,
        metadata: Object.freeze({ protected: false }),
      }
      const node: FileSystemNode =
        text && contentId
          ? Object.freeze({
              ...base,
              kind: 'file',
              mime: 'text/plain',
              byteLength: bytes,
              contentId,
              contentRevision: 1,
            })
          : Object.freeze({ ...base, kind: 'directory' })
      const nextNodes = new Map(state.nodes)
      nextNodes.set(id, node)
      nextNodes.set(
        parentId,
        Object.freeze({
          ...parent,
          updatedAt: now,
          metadataRevision: parent.metadataRevision + 1,
        }),
      )
      const nextChildren = new Map(state.children)
      const nextSiblings = new Map(siblings)
      nextSiblings.set(normalized.value, id)
      nextChildren.set(parentId, nextSiblings)
      const nextContents = new Map(state.contents)
      if (text && contentId) nextContents.set(contentId, text.content)
      state = {
        nodes: nextNodes,
        children: nextChildren,
        contents: nextContents,
        totalBytes: state.totalBytes + bytes,
      }
      return { ok: true, value: id }
    } catch {
      return failure(
        'STORAGE_UNAVAILABLE',
        'Could not prepare the memory transaction.',
      )
    }
  }

  function getNode(id: NodeId): VfsResult<FileSystemNode> {
    const node = state.nodes.get(id)
    return node
      ? { ok: true, value: node }
      : failure('NOT_FOUND', 'Node does not exist.', id)
  }
  const repository: VfsRepository = {
    async writeFile(id, content, writeOptions) {
      const node = state.nodes.get(id)
      if (!node) return failure('NOT_FOUND', 'File does not exist.', id)
      if (node.kind !== 'file')
        return failure('NOT_FILE', 'Node is not a file.', id)
      if (node.metadata.protected || inSystem(id))
        return failure('PROTECTED', 'File is read-only.', id)
      if (
        !writeOptions ||
        !Number.isSafeInteger(writeOptions.expectedContentRevision) ||
        writeOptions.expectedContentRevision < 1 ||
        !writeOptions.requestId?.trim()
      )
        return failure(
          'INVALID_REQUEST',
          'A positive expected revision and non-empty request ID are required.',
          id,
        )
      if (node.contentRevision !== writeOptions.expectedContentRevision)
        return {
          ok: false,
          error: {
            code: 'CONFLICT',
            message: 'File changed since it was read.',
            nodeId: id,
            expectedRevision: writeOptions.expectedContentRevision,
            actualRevision: node.contentRevision,
          },
        }
      if (
        node.contentRevision >= Number.MAX_SAFE_INTEGER ||
        node.metadataRevision >= Number.MAX_SAFE_INTEGER
      )
        return failure('CORRUPT_DATA', 'File revision cannot advance.', id)
      const prepared = prepareTextContent(content)
      if (!prepared.ok) return prepared
      const totalBytes =
        state.totalBytes - node.byteLength + prepared.value.byteLength
      if (
        prepared.value.byteLength > VFS_LIMITS.maxFileBytes ||
        totalBytes > VFS_LIMITS.maxTotalBytes
      )
        return failure(
          'TOO_LARGE',
          'File or total text size limit exceeded.',
          id,
        )
      try {
        const operationId = options.createOperationId()
        const now = options.now()
        if (!operationId?.trim() || !Number.isFinite(now))
          return failure(
            'CORRUPT_DATA',
            'Operation identity or timestamp is invalid.',
            id,
          )
        const nextNode = Object.freeze({
          ...node,
          byteLength: prepared.value.byteLength,
          updatedAt: now,
          metadataRevision: node.metadataRevision + 1,
          contentRevision: node.contentRevision + 1,
        })
        const nextNodes = new Map(state.nodes)
        nextNodes.set(id, nextNode)
        const nextContents = new Map(state.contents)
        nextContents.set(node.contentId, prepared.value.content)
        const receipt = Object.freeze({
          contentRevision: nextNode.contentRevision,
          operationId,
          originRequestId: writeOptions.requestId,
        })
        state = {
          ...state,
          nodes: nextNodes,
          contents: nextContents,
          totalBytes,
        }
        return { ok: true, value: receipt }
      } catch {
        return failure(
          'STORAGE_UNAVAILABLE',
          'Could not prepare the memory write.',
          id,
        )
      }
    },
    async createDirectory(parentId, name) {
      return create(parentId, name)
    },
    async createFile(parentId, name, content) {
      if (!content)
        return failure('INVALID_CONTENT', 'File content is required.')
      return create(parentId, name, content)
    },
    async readDocument(id) {
      const result = getNode(id)
      if (!result.ok) return result
      const node = result.value
      if (node.kind !== 'file')
        return failure('NOT_FILE', 'Node is not a file.', id)
      const content = state.contents.get(node.contentId)
      if (!content)
        return failure('CORRUPT_DATA', 'File content is missing.', id)
      return {
        ok: true,
        value: Object.freeze({
          node,
          content,
          contentRevision: node.contentRevision,
        }),
      }
    },
    async getNode(id) {
      return getNode(id)
    },
    async getChildren(id) {
      const result = getNode(id)
      if (!result.ok) return result
      if (result.value.kind !== 'directory')
        return failure('NOT_DIRECTORY', 'Node is not a directory.', id)
      const entries = Array.from(
        state.children.get(id)?.values() ?? [],
        (child) => state.nodes.get(child)!,
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
              : state.children.get(current.id)?.get(segment.name)
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
        current = state.nodes.get(current.parentId)!
      }
      return { ok: true, value: '/' + names.reverse().join('/') }
    },
  }
  return { ok: true, value: repository }
}
