import type { VirtualFileSystem } from '../../core/filesystem/service'
import type {
  DocumentRead,
  NodeId,
  VfsErrorCode,
  VfsResult,
} from '../../core/filesystem/types'
import type { RefreshService } from '../../core/refresh/service'
export type NotesVfs = Pick<
  VirtualFileSystem,
  'readFile' | 'pathOf' | 'subscribe' | 'writeFile' | 'createFile'
>
interface EditorState {
  readonly fileId: NodeId | null
  readonly name: string
  readonly buffer: string
  readonly baseline: string
  readonly baselineRevision: number
  readonly dirty: boolean
  readonly saving: boolean
  readonly closing: boolean
  readonly conflict: boolean
  readonly availability: 'available' | 'deleted' | 'unavailable'
  readonly notice: string | null
}
export type NotesSnapshot =
  | { readonly status: 'loading' }
  | ({
      readonly status: 'ready'
      readonly document: DocumentRead | null
      readonly path: string
    } & EditorState)
  | { readonly status: 'error'; readonly message: string }
function message(code: VfsErrorCode): string {
  if (code === 'NOT_FOUND')
    return 'This file was removed or is no longer available. Your edits have been kept.'
  if (code === 'ALREADY_EXISTS')
    return 'An item with this name already exists. Choose another name.'
  if (code === 'INVALID_NAME') return 'Enter a valid file name.'
  if (code === 'NOT_FILE') return 'This item is not a text file.'
  if (code === 'CONFLICT')
    return 'The file changed elsewhere. Your edits have been kept. Discard edits and reload to use the saved version.'
  if (code === 'QUOTA')
    return 'Browser storage is full. Your edits have been kept.'
  if (code === 'TOO_LARGE')
    return 'The file exceeds the workspace size limit. Your edits have been kept.'
  if (code === 'PROTECTED')
    return 'This file is protected. Your edits have been kept.'
  if (code === 'CORRUPT_DATA')
    return 'The saved file could not be verified. Its data has been preserved.'
  return 'The file could not be read or saved. Your edits have been kept. Retry to continue.'
}
export function createNotesSession(
  vfs: NotesVfs,
  refresh: Pick<RefreshService, 'subscribe' | 'getSnapshot'>,
  fileId: NodeId | null,
  onFileBound: (id: NodeId) => void = () => {},
) {
  let snapshot: NotesSnapshot = Object.freeze({
    ...(fileId
      ? { status: 'loading' as const }
      : {
          status: 'ready' as const,
          document: null,
          fileId: null,
          name: 'Untitled',
          path: '',
          buffer: '',
          baseline: '',
          baselineRevision: 0,
          dirty: false,
          saving: false,
          closing: false,
          conflict: false,
          availability: 'available' as const,
          notice: null,
        }),
  })
  let running = false
  let generation = 0
  let editVersion = 0
  let lifetime = 0
  let pendingSave: Promise<boolean> | null = null
  let pendingCreate: Promise<VfsResult<NodeId>> | null = null
  let requestId: string | null = null
  let closeRequest: Promise<boolean> | null = null
  let finishClose: ((allow: boolean) => void) | null = null
  let offVfs: (() => void) | undefined
  let offRefresh: (() => void) | undefined
  const listeners = new Set<() => void>()
  function publish(next: NotesSnapshot) {
    snapshot = Object.freeze(next)
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* Observers do not own document operations. */
      }
    }
  }
  function readError(code: VfsErrorCode) {
    if (snapshot.status === 'ready')
      publish({
        ...snapshot,
        availability: code === 'NOT_FOUND' ? 'deleted' : 'unavailable',
        notice: message(code),
      })
    else publish({ status: 'error', message: message(code) })
  }
  async function reload(discard = false) {
    if (!running || !fileId) return
    if (pendingSave || pendingCreate) return
    const token = ++generation
    const editsAtStart = editVersion
    const valid = () => running && token === generation
    if (snapshot.status !== 'ready') publish({ status: 'loading' })
    try {
      const document = await vfs.readFile(fileId)
      if (!valid()) return
      if (!document.ok) {
        readError(document.error.code)
        return
      }
      const path = await vfs.pathOf(fileId)
      if (!valid()) return
      if (!path.ok) {
        readError(path.error.code)
        return
      }
      const previous = snapshot.status === 'ready' ? snapshot : null
      const keep = previous?.dirty && (!discard || editVersion !== editsAtStart)
      const changed =
        !!keep && document.value.contentRevision !== previous.baselineRevision
      publish({
        status: 'ready',
        document: document.value,
        fileId,
        name: document.value.node.name,
        path: path.value,
        buffer: keep ? previous.buffer : document.value.content.text,
        baseline: keep ? previous.baseline : document.value.content.text,
        baselineRevision: keep
          ? previous.baselineRevision
          : document.value.contentRevision,
        dirty: !!keep,
        saving: false,
        closing: !!closeRequest,
        conflict: changed,
        availability: 'available',
        notice: changed ? message('CONFLICT') : null,
      })
    } catch {
      if (valid()) readError('STORAGE_UNAVAILABLE')
    }
  }
  function settleClose(allow: boolean) {
    const resolve = finishClose
    closeRequest = null
    finishClose = null
    if (snapshot.status === 'ready') publish({ ...snapshot, closing: false })
    resolve?.(allow)
  }
  function save(): Promise<boolean> {
    if (pendingCreate) return pendingCreate.then(() => false)
    if (pendingSave) return pendingSave
    if (
      !running ||
      !fileId ||
      snapshot.status !== 'ready' ||
      snapshot.conflict ||
      snapshot.availability !== 'available'
    )
      return Promise.resolve(false)
    if (!snapshot.dirty) return Promise.resolve(true)
    const sourceId = fileId
    const text = snapshot.buffer,
      revision = snapshot.baselineRevision,
      token = lifetime
    ++generation // A pre-save read cannot replace the committed baseline.
    const id = crypto.randomUUID()
    requestId = id
    let committed = false
    const operation = Promise.resolve().then(async () => {
      try {
        if (!running || lifetime !== token) return false
        const result = await vfs.writeFile(
          sourceId,
          { kind: 'text', encoding: 'utf-8', text },
          { expectedContentRevision: revision, requestId: id },
        )
        if (!running || lifetime !== token || snapshot.status !== 'ready')
          return false
        if (!result.ok) {
          publish({
            ...snapshot,
            saving: false,
            conflict: result.error.code === 'CONFLICT' || snapshot.conflict,
            availability:
              result.error.code === 'NOT_FOUND'
                ? 'deleted'
                : snapshot.availability,
            notice: message(result.error.code),
          })
          return false
        }
        committed = true
        const dirty = snapshot.buffer !== text
        publish({
          ...snapshot,
          baseline: text,
          baselineRevision: result.value.contentRevision,
          dirty,
          saving: false,
          notice: null,
        })
      } catch {
        if (running && lifetime === token && snapshot.status === 'ready')
          publish({
            ...snapshot,
            saving: false,
            notice: message('STORAGE_UNAVAILABLE'),
          })
        return false
      } finally {
        if (pendingSave === operation) {
          pendingSave = null
          requestId = null
          if (committed && running && lifetime === token) {
            // Recheck metadata/content after commit, including changes from another connection.
            await reload()
          }
        }
      }
      return (
        committed &&
        running &&
        lifetime === token &&
        snapshot.status === 'ready' &&
        !snapshot.dirty &&
        !snapshot.conflict &&
        snapshot.availability === 'available'
      )
    })
    pendingSave = operation
    publish({ ...snapshot, saving: true, notice: null })
    return operation
  }
  function saveAs(parentId: NodeId, name: string): Promise<VfsResult<NodeId>> {
    if (pendingCreate) return pendingCreate
    if (pendingSave || !running || snapshot.status !== 'ready')
      return Promise.resolve({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'A save is already running.',
        },
      })
    let created = false
    const text = snapshot.buffer,
      token = lifetime
    ++generation
    const operation = Promise.resolve().then(
      async (): Promise<VfsResult<NodeId>> => {
        try {
          if (!running || token !== lifetime)
            return {
              ok: false,
              error: { code: 'INVALID_REQUEST', message: 'Document closed.' },
            }
          const result = await vfs.createFile(parentId, name, {
            kind: 'text',
            encoding: 'utf-8',
            text,
          })
          if (!running || token !== lifetime || snapshot.status !== 'ready')
            return result
          if (!result.ok) {
            publish({
              ...snapshot,
              saving: false,
              notice: message(result.error.code),
            })
            return result
          }
          created = true
          fileId = result.value
          onFileBound(fileId)
          publish({
            ...snapshot,
            fileId,
            name: name.normalize('NFC'),
            document: null,
            path: '',
            baseline: text,
            baselineRevision: 1,
            dirty: snapshot.buffer !== text,
            saving: false,
            conflict: false,
            availability: 'available',
            notice: null,
          })
          return result
        } catch {
          if (running && token === lifetime && snapshot.status === 'ready')
            publish({
              ...snapshot,
              saving: false,
              notice: message('STORAGE_UNAVAILABLE'),
            })
          return {
            ok: false,
            error: {
              code: 'STORAGE_UNAVAILABLE',
              message: 'File could not be created.',
            },
          }
        } finally {
          if (pendingCreate === operation) {
            pendingCreate = null
            if (created && running && token === lifetime && fileId)
              await reload()
          }
        }
      },
    )
    pendingCreate = operation
    publish({ ...snapshot, saving: true, notice: null })
    return operation
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retry: () => reload(),
    discardAndReload: () => reload(true),
    edit: (buffer: string) => {
      if (!running || snapshot.status !== 'ready') return
      ++editVersion
      publish({ ...snapshot, buffer, dirty: buffer !== snapshot.baseline })
    },
    save,
    saveAs,
    requestClose: () => {
      if (closeRequest) return closeRequest
      if (
        snapshot.status !== 'ready' ||
        (!snapshot.dirty && !pendingSave && !pendingCreate)
      )
        return Promise.resolve(true)
      closeRequest = new Promise<boolean>((resolve) => {
        finishClose = resolve
      })
      publish({ ...snapshot, closing: true })
      return closeRequest
    },
    cancelClose: () => {
      if (!pendingSave && !pendingCreate) settleClose(false)
    },
    discardClose: () => {
      if (!pendingSave && !pendingCreate) settleClose(true)
    },
    saveAndClose: async () => {
      if (!closeRequest) return
      await save()
      if (
        running &&
        snapshot.status === 'ready' &&
        !snapshot.dirty &&
        !snapshot.saving &&
        !snapshot.conflict &&
        snapshot.availability === 'available'
      )
        settleClose(true)
    },
    start: () => {
      if (running) return
      running = true
      ++lifetime
      offVfs = vfs.subscribe({ kind: 'all' }, (event) => {
        const currentId = fileId
        if (!currentId || event.originRequestId === requestId) return
        if (
          [
            event.contentIds,
            event.metadataIds,
            event.pathIds,
            event.removedIds,
          ].some((ids) => ids.includes(currentId))
        ) {
          void reload()
        }
      })
      let revision = refresh.getSnapshot().revision
      offRefresh = refresh.subscribe(() => {
        const next = refresh.getSnapshot().revision
        if (next !== revision) {
          revision = next
          void reload()
        }
      })
      void reload()
    },
    stop: () => {
      running = false
      ++generation
      ++lifetime
      settleClose(false)
      if (snapshot.status === 'ready') publish({ ...snapshot, saving: false })
      pendingSave = null
      pendingCreate = null
      requestId = null
      offVfs?.()
      offRefresh?.()
      offVfs = undefined
      offRefresh = undefined
    },
  }
}
