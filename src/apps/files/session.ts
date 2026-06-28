import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { RefreshService } from '../../core/refresh/service'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import type {
  FileSystemNode,
  NodeId,
  VfsErrorCode,
} from '../../core/filesystem/types'
export interface Breadcrumb {
  readonly id: NodeId
  readonly name: string
}
export interface DirectorySnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  readonly directoryId: NodeId | null
  readonly entries: readonly FileSystemNode[]
  readonly breadcrumbs: readonly Breadcrumb[]
  readonly error: string | null
  readonly notice: string | null
}
export function createDirectorySession(
  vfs: Pick<
    VirtualFileSystem,
    'listDirectory' | 'ancestors' | 'resolve' | 'subscribe'
  >,
  refresh: Pick<RefreshService, 'getSnapshot' | 'subscribe'>,
) {
  let snapshot: DirectorySnapshot = Object.freeze({
    status: 'loading',
    directoryId: null,
    entries: Object.freeze([]),
    breadcrumbs: Object.freeze([]),
    error: null,
    notice: null,
  })
  let running = false
  let generation = 0
  let unsubscribeVfs: (() => void) | undefined
  let unsubscribeRefresh: (() => void) | undefined
  const listeners = new Set<() => void>()
  function publish(next: DirectorySnapshot) {
    snapshot = Object.freeze(next)
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* Observers cannot cancel folder navigation. */
      }
    }
  }
  const current = (request: number) => running && request === generation
  function errorMessage(code: VfsErrorCode) {
    if (code === 'CORRUPT_DATA')
      return 'This folder could not be verified. Your saved data has been preserved.'
    if (code === 'NOT_DIRECTORY') return 'This item is no longer a folder.'
    return 'This folder could not be read. Please retry.'
  }
  async function load(
    id: NodeId,
    notice: string | null = null,
    fallback = true,
  ) {
    if (!running) return
    const request = ++generation
    publish({
      ...snapshot,
      status: 'loading',
      directoryId: id,
      breadcrumbs:
        snapshot.directoryId === id ? snapshot.breadcrumbs : Object.freeze([]),
      entries: Object.freeze([]),
      error: null,
      notice,
    })
    try {
      const listing = await vfs.listDirectory(id)
      if (!current(request)) return
      if (!listing.ok) {
        if (listing.error.code === 'NOT_FOUND' && fallback) {
          await home(
            'The previous folder was removed. Showing your home folder.',
            false,
          )
          return
        }
        publish({
          ...snapshot,
          status: 'error',
          error: errorMessage(listing.error.code),
        })
        return
      }
      const chain = await vfs.ancestors(id)
      if (!current(request)) return
      if (!chain.ok) {
        if (chain.error.code === 'NOT_FOUND' && fallback) {
          await home(
            'The previous folder was removed. Showing your home folder.',
            false,
          )
          return
        }
        publish({
          ...snapshot,
          status: 'error',
          error: errorMessage(chain.error.code),
        })
        return
      }
      if (chain.value.some((node) => node.kind !== 'directory'))
        throw new Error('Invalid folder ancestry')
      const breadcrumbs = chain.value.map((node) =>
        Object.freeze({
          id: node.id,
          name: node.id === ROOT_NODE_ID ? 'Workspace' : node.name,
        }),
      )
      publish({
        status: 'ready',
        directoryId: id,
        entries: Object.freeze(
          [...listing.value].sort((a, b) =>
            a.kind === b.kind
              ? a.name < b.name
                ? -1
                : a.name > b.name
                  ? 1
                  : 0
              : a.kind === 'directory'
                ? -1
                : 1,
          ),
        ),
        breadcrumbs: Object.freeze(breadcrumbs.reverse()),
        error: null,
        notice,
      })
    } catch {
      if (current(request))
        publish({
          ...snapshot,
          status: 'error',
          error: 'This folder could not be read. Please retry.',
        })
    }
  }
  async function home(notice: string | null = null, fallback = true) {
    if (!running) return
    const request = ++generation
    publish({
      ...snapshot,
      status: 'loading',
      directoryId: null,
      breadcrumbs: Object.freeze([]),
      entries: Object.freeze([]),
      error: null,
      notice,
    })
    try {
      const resolved = await vfs.resolve('/home/user', ROOT_NODE_ID)
      if (!current(request)) return
      if (resolved.ok) await load(resolved.value, notice, fallback)
      else if (resolved.error.code === 'NOT_FOUND')
        await load(
          ROOT_NODE_ID,
          'Your home folder is unavailable. Showing the workspace.',
          false,
        )
      else
        publish({
          ...snapshot,
          status: 'error',
          error: errorMessage(resolved.error.code),
        })
    } catch {
      if (current(request))
        publish({
          ...snapshot,
          status: 'error',
          error: 'Your home folder could not be opened. Please retry.',
        })
    }
  }
  const reload = () =>
    snapshot.directoryId ? load(snapshot.directoryId) : home()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    navigate: (id: NodeId) => load(id),
    home: () => home(),
    reload,
    start: () => {
      if (running) return
      running = true
      unsubscribeVfs = vfs.subscribe({ kind: 'all' }, (event) => {
        const relevant = new Set([
          snapshot.directoryId,
          ...snapshot.breadcrumbs.map((crumb) => crumb.id),
          ...snapshot.entries.map((entry) => entry.id),
        ])
        if (snapshot.status === 'loading') {
          void reload()
          return
        }
        if (
          [
            ...event.directoryIds,
            ...event.metadataIds,
            ...event.pathIds,
            ...event.removedIds,
          ].some((id) => relevant.has(id))
        )
          void reload()
      })
      let revision = refresh.getSnapshot().revision
      unsubscribeRefresh = refresh.subscribe(() => {
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
      unsubscribeVfs?.()
      unsubscribeRefresh?.()
      unsubscribeVfs = undefined
      unsubscribeRefresh = undefined
    },
  }
}
export type DirectorySession = ReturnType<typeof createDirectorySession>
