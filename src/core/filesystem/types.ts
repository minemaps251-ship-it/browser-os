export type NodeId = string & { readonly __brand: 'NodeId' }
export type ContentId = string & { readonly __brand: 'ContentId' }

interface NodeBase {
  readonly id: NodeId
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly metadataRevision: number
  readonly metadata: Readonly<{ protected: boolean }>
}

export interface DirectoryNode extends NodeBase {
  readonly kind: 'directory'
  // Only the reserved root may have a null parent and an empty name.
  readonly parentId: NodeId | null
}

export interface FileNode extends NodeBase {
  readonly kind: 'file'
  readonly parentId: NodeId
  readonly mime: string
  readonly byteLength: number
  readonly contentId: ContentId
  readonly contentRevision: number
}

export type FileSystemNode = DirectoryNode | FileNode
export type FileContent = Readonly<{
  kind: 'text'
  text: string
  encoding: 'utf-8'
}>

// Metadata and text must later be read together in one repository transaction.
export interface DocumentRead {
  readonly node: FileNode
  readonly content: FileContent
  readonly contentRevision: number
}

export type VfsErrorCode =
  | 'NOT_FOUND'
  | 'NOT_DIRECTORY'
  | 'NOT_FILE'
  | 'INVALID_NAME'
  | 'INVALID_PATH'
  | 'INVALID_CONTENT'
  | 'ALREADY_EXISTS'
  | 'CYCLE'
  | 'PROTECTED'
  | 'CONFLICT'
  | 'TOO_LARGE'
  | 'QUOTA'
  | 'STORAGE_UNAVAILABLE'
  | 'CORRUPT_DATA'

export interface VfsError {
  readonly code: VfsErrorCode
  readonly message: string
  readonly nodeId?: NodeId
  readonly path?: string
  readonly expectedRevision?: number
  readonly actualRevision?: number
}

export type VfsResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: VfsError }

export interface StoredFileContent {
  readonly id: ContentId
  readonly content: FileContent
}
