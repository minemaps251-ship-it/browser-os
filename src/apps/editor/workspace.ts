import type { NodeId } from '../../core/filesystem/types'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { RefreshService } from '../../core/refresh/service'
import {
  createTextDocumentSession,
  type TextDocumentSnapshot,
} from '../text-document/session'

export const MAX_EDITOR_TABS = 20
export interface EditorTab {
  readonly id: string
  readonly fileId: NodeId | null
  readonly session: ReturnType<typeof createTextDocumentSession>
  readonly document: TextDocumentSnapshot
}
interface WorkspaceSnapshot {
  readonly tabs: readonly EditorTab[]
  readonly activeId: string | null
  readonly closing: boolean
  readonly modalOpen: boolean
  readonly notice: string | null
}
export function createEditorWorkspace(
  vfs: VirtualFileSystem,
  refresh: RefreshService,
  initialFile: NodeId | null,
) {
  type Entry = {
    id: string
    fileId: NodeId | null
    session: ReturnType<typeof createTextDocumentSession>
    off?: () => void
  }
  let entries: Entry[] = []
  let activeId: string | null = null
  let nextId = 0
  let running = false
  let lifetime = 0
  let closing = false
  let modalOpen = false
  let notice: string | null = null
  let operation: Promise<boolean> | null = null
  let snapshot: WorkspaceSnapshot
  const listeners = new Set<() => void>()
  function publish() {
    snapshot = Object.freeze({
      tabs: Object.freeze(
        entries.map((entry) =>
          Object.freeze({
            id: entry.id,
            fileId: entry.fileId,
            session: entry.session,
            document: entry.session.getSnapshot(),
          }),
        ),
      ),
      activeId,
      closing,
      modalOpen,
      notice,
    })
    listeners.forEach((listener) => {
      try {
        listener()
      } catch {
        /* Observers do not own workspace transitions. */
      }
    })
  }
  function connect(entry: Entry) {
    entry.off = entry.session.subscribe(publish)
    entry.session.start()
  }
  function add(fileId: NodeId | null) {
    const entry: Entry = {
      id: `document-${++nextId}`,
      fileId,
      session: createTextDocumentSession(vfs, refresh, fileId, (id) => {
        entry.fileId = id
        publish()
      }),
    }
    entries.push(entry)
    activeId = entry.id
    if (running) connect(entry)
    publish()
    return entry
  }
  function canAdd() {
    if (!running || closing || modalOpen) return false
    if (entries.length >= MAX_EDITOR_TABS) {
      notice = `Close a tab before opening another document (limit ${MAX_EDITOR_TABS}).`
      publish()
      return false
    }
    notice = null
    return true
  }
  function coordinate(
    work: (valid: () => boolean) => Promise<boolean>,
    keepLockedOnSuccess = false,
  ) {
    const token = lifetime
    closing = true
    const pending = Promise.resolve()
      .then(() => work(() => running && lifetime === token))
      .catch(() => false)
    operation = pending
    publish()
    void pending.then((allow) => {
      if (operation !== pending) return
      if (!allow) entries.forEach((entry) => entry.session.resetCloseApproval())
      operation = null
      closing = allow && keepLockedOnSuccess
      publish()
    })
    return pending
  }
  add(initialFile)
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    select: (id: string) => {
      if (
        !running ||
        closing ||
        modalOpen ||
        !entries.some((entry) => entry.id === id)
      )
        return false
      activeId = id
      publish()
      return true
    },
    newDocument: () => {
      if (canAdd()) {
        add(null)
        return true
      }
      return false
    },
    openFile: (fileId: NodeId) => {
      if (!running || closing || modalOpen) return false
      const entry = entries.find((entry) => entry.fileId === fileId)
      if (entry) {
        activeId = entry.id
        notice = null
        publish()
        return true
      }
      if (!canAdd()) return false
      add(fileId)
      return true
    },
    setModalOpen: (value: boolean) => {
      if (modalOpen === value) return
      modalOpen = value
      publish()
    },
    requestCloseTab: (id: string): Promise<boolean> => {
      if (!running || closing || modalOpen) return Promise.resolve(false)
      const entry = entries.find((entry) => entry.id === id)
      if (!entry) return Promise.resolve(false)
      activeId = id
      return coordinate(async (valid) => {
        if (!valid()) return false
        const allow = await entry.session.requestClose()
        if (!valid() || !allow || !entry.session.hasCloseApproval())
          return false
        const index = entries.indexOf(entry)
        entry.off?.()
        entry.session.stop()
        entries = entries.filter((item) => item !== entry)
        activeId = entries[Math.min(index, entries.length - 1)]?.id ?? null
        notice = null
        publish()
        return true
      })
    },
    requestCloseWindow: (): Promise<boolean> => {
      if (!running || closing || modalOpen) return Promise.resolve(false)
      return coordinate(async (valid) => {
        // Retain all drafts until every approval still covers the latest edit.
        while (valid()) {
          for (const entry of entries) {
            if (!valid()) return false
            if (entry.session.hasCloseApproval()) continue
            activeId = entry.id
            publish()
            if (!(await entry.session.requestClose())) return false
          }
          if (
            valid() &&
            entries.every((entry) => entry.session.hasCloseApproval())
          )
            return true
        }
        return false
      }, true)
    },
    start: () => {
      if (running) return
      running = true
      ++lifetime
      entries.forEach(connect)
      publish()
    },
    stop: () => {
      running = false
      ++lifetime
      operation = null
      closing = false
      modalOpen = false
      entries.forEach((entry) => {
        entry.off?.()
        entry.off = undefined
        entry.session.stop()
      })
      publish()
    },
  }
}
export type EditorWorkspace = ReturnType<typeof createEditorWorkspace>
