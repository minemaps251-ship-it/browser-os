import { openDatabase } from '../core/storage/database'
import { validateStoredVfs } from '../core/storage/readRepository'
import { createBrowserRuntime, type BrowserRuntime } from './createRuntime'
import {
  persistentWorkspace,
  temporaryWorkspace,
  type Workspace,
} from './workspace'

export type BootState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly runtime: BrowserRuntime }
  | { readonly status: 'stopped' }
const defaults = {
  open: openDatabase,
  validate: validateStoredVfs,
  createRuntime: (workspace: Workspace) =>
    createBrowserRuntime(undefined, workspace),
  temporary: temporaryWorkspace,
}
/** Owns the startup attempt and resource lifetime, independently of React mounting. */
export function createBootController(dependencies: typeof defaults = defaults) {
  let state: BootState = { status: 'loading' }
  let generation = 0
  let stopped = false
  let pendingWorkspace: Workspace | undefined
  const listeners = new Set<() => void>()
  const publish = (next: BootState) => {
    state = next
    for (const listener of listeners) listener()
  }
  const release = () => {
    pendingWorkspace?.dispose()
    pendingWorkspace = undefined
    if (state.status === 'ready') state.runtime.dispose()
  }
  async function start() {
    if (stopped) return
    const attempt = ++generation
    release()
    publish({ status: 'loading' })
    let workspace: Workspace | undefined
    try {
      const opened = await dependencies.open({
        onVersionChange: () => {
          if (stopped || attempt !== generation) return
          ++generation
          release()
          publish({
            status: 'error',
            message:
              'Your workspace was opened by a newer version. Close other BrowserOS tabs and retry.',
          })
        },
      })
      if (!opened.ok) {
        if (!stopped && attempt === generation)
          publish({
            status: 'error',
            message:
              opened.error.code === 'NEWER_DATABASE'
                ? 'This workspace needs a newer version of BrowserOS.'
                : 'Your saved workspace could not be opened. Close other BrowserOS tabs or check browser storage permissions, then retry.',
          })
        return
      }
      workspace = persistentWorkspace(opened.value)
      if (stopped || attempt !== generation) {
        workspace.dispose()
        return
      }
      pendingWorkspace = workspace
      const valid = await dependencies.validate(opened.value)
      if (stopped || attempt !== generation) {
        workspace.dispose()
        return
      }
      if (!valid.ok || opened.value.closed) {
        workspace.dispose()
        pendingWorkspace = undefined
        publish({
          status: 'error',
          message:
            'Your saved workspace could not be verified. Saved data has been preserved. You can retry or use a temporary workspace.',
        })
        return
      }
      const runtime = dependencies.createRuntime(workspace)
      pendingWorkspace = undefined
      workspace = undefined
      publish({ status: 'ready', runtime })
    } catch {
      workspace?.dispose()
      if (attempt === generation) pendingWorkspace = undefined
      if (!stopped && attempt === generation)
        publish({
          status: 'error',
          message:
            'Your workspace could not start. Saved data has been preserved.',
        })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start,
    useTemporary: () => {
      if (stopped || state.status !== 'error') return
      ++generation
      let workspace: Workspace | undefined
      try {
        workspace = dependencies.temporary()
        publish({
          status: 'ready',
          runtime: dependencies.createRuntime(workspace),
        })
      } catch {
        workspace?.dispose()
        publish({
          status: 'error',
          message: 'The temporary workspace could not start.',
        })
      }
    },
    dispose: () => {
      if (stopped) return
      stopped = true
      ++generation
      release()
      publish({ status: 'stopped' })
      listeners.clear()
    },
  }
}
export type BootController = ReturnType<typeof createBootController>
