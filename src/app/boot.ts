import {
  getRecoveryGuidance,
  type RecoveryGuidance,
  type RecoveryReason,
} from './recovery'
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
  | {
      readonly status: 'error'
      readonly message: string
      readonly reason: RecoveryReason
      readonly guidance: RecoveryGuidance
    }
  | { readonly status: 'ready'; readonly runtime: BrowserRuntime }
  | { readonly status: 'stopped' }
const defaults = {
  open: openDatabase,
  validate: validateStoredVfs,
  createRuntime: (workspace: Workspace) =>
    createBrowserRuntime(undefined, workspace),
  temporary: temporaryWorkspace,
  initializeSettings: (workspace: Workspace) => workspace.settings.load(),
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
  const fail = (reason: RecoveryReason) => {
    const guidance = getRecoveryGuidance(reason)
    publish({ status: 'error', reason, guidance, message: guidance.message })
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
          fail('VERSION_CHANGED')
        },
      })
      if (!opened.ok) {
        if (!stopped && attempt === generation) fail(opened.error.code)
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
        fail(
          !valid.ok && valid.error.code === 'CORRUPT_DATA'
            ? 'CORRUPT_DATA'
            : 'READ_FAILED',
        )
        return
      }
      const settings = await dependencies.initializeSettings(workspace)
      if (stopped || attempt !== generation) {
        workspace.dispose()
        return
      }
      if (!settings.ok || opened.value.closed) {
        workspace.dispose()
        pendingWorkspace = undefined
        fail('READ_FAILED')
        return
      }
      const runtime = dependencies.createRuntime(workspace)
      pendingWorkspace = undefined
      workspace = undefined
      publish({ status: 'ready', runtime })
    } catch {
      workspace?.dispose()
      if (attempt === generation) pendingWorkspace = undefined
      if (!stopped && attempt === generation) fail('START_FAILED')
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
        fail('TEMPORARY_FAILED')
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
