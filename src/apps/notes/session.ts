import type { VirtualFileSystem } from '../../core/filesystem/service'
import type {
  DocumentRead,
  NodeId,
  VfsErrorCode,
} from '../../core/filesystem/types'
import type { RefreshService } from '../../core/refresh/service'
export type NotesVfs = Pick<
  VirtualFileSystem,
  'readFile' | 'pathOf' | 'subscribe'
>
export type NotesSnapshot =
  | { readonly status: 'idle' | 'loading' }
  | {
      readonly status: 'ready'
      readonly document: DocumentRead
      readonly path: string
    }
  | { readonly status: 'error'; readonly message: string }
function message(code: VfsErrorCode): string {
  if (code === 'NOT_FOUND')
    return 'This file was removed or is no longer available.'
  if (code === 'NOT_FILE') return 'This item is not a text file.'
  if (code === 'CORRUPT_DATA')
    return 'The saved file could not be verified. Its data has been preserved.'
  return 'The file could not be read. Retry to continue.'
}
export function createNotesSession(
  vfs: NotesVfs,
  refresh: Pick<RefreshService, 'subscribe' | 'getSnapshot'>,
  fileId: NodeId | null,
) {
  let snapshot: NotesSnapshot = Object.freeze({
    status: fileId ? 'loading' : 'idle',
  })
  let running = false
  let generation = 0
  let offVfs: (() => void) | undefined
  let offRefresh: (() => void) | undefined
  const listeners = new Set<() => void>()
  function publish(next: NotesSnapshot) {
    snapshot = Object.freeze(next)
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* Observers do not invalidate document reads. */
      }
    }
  }
  async function reload() {
    if (!running || !fileId) return
    const token = ++generation
    const valid = () => running && token === generation
    publish({ status: 'loading' })
    try {
      const document = await vfs.readFile(fileId)
      if (!valid()) return
      if (!document.ok) {
        publish({ status: 'error', message: message(document.error.code) })
        return
      }
      const path = await vfs.pathOf(fileId)
      if (!valid()) return
      if (!path.ok) {
        publish({ status: 'error', message: message(path.error.code) })
        return
      }
      publish({ status: 'ready', document: document.value, path: path.value })
    } catch {
      if (valid())
        publish({
          status: 'error',
          message: 'The file could not be read. Retry to continue.',
        })
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    retry: reload,
    start: () => {
      if (running) return
      running = true
      if (!fileId) return
      offVfs = vfs.subscribe({ kind: 'all' }, (event) => {
        if (
          [
            event.contentIds,
            event.metadataIds,
            event.pathIds,
            event.removedIds,
          ].some((ids) => ids.includes(fileId))
        )
          void reload()
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
      offVfs?.()
      offRefresh?.()
      offVfs = undefined
      offRefresh = undefined
    },
  }
}
