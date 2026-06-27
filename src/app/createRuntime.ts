import { createElement, type ReactElement } from 'react'
import { createRegistry } from '../core/applications/registry'
import type { AppId, ProcessId, WindowId } from '../core/shared/ids'
import { createRuntime } from '../core/runtime/service'
import { temporaryWorkspace, type Workspace } from './workspace'
import { builtInApps, type AppRegistration } from './builtInApps'

export function createBrowserRuntime(
  registrations: readonly AppRegistration[] = builtInApps,
  workspace: Workspace = temporaryWorkspace(),
) {
  const registry = createRegistry(registrations.map((entry) => entry.manifest))
  const entries = new Map(
    registrations.map((entry) => [entry.manifest.id, entry]),
  )
  const contents = new Map<AppId, ReactElement>()
  const runtime = createRuntime({
    registry,
    ids: {
      process: () => crypto.randomUUID() as ProcessId,
      window: () => crypto.randomUUID() as WindowId,
    },
    now: Date.now,
    getUsableArea: () => {
      const area = document
        .getElementById('desktop-workspace')
        ?.getBoundingClientRect()
      return {
        width: Math.max(1, area?.width || window.innerWidth - 32),
        height: Math.max(1, area?.height || window.innerHeight - 180),
      }
    },
    load: async (appId, scope) => {
      const entry = entries.get(appId)
      if (!entry) throw new Error('Missing application renderer')
      const module = await entry.load()
      if (!scope.signal.aborted)
        contents.set(appId, createElement(module.default))
    },
    onCleanupError: (error) => {
      console.error('Application cleanup failed', error)
    },
  })
  let disposed = false
  return {
    ...runtime,
    vfs: workspace.vfs,
    settings: workspace.settings,
    storageMode: workspace.mode,
    getContent: (appId: AppId) => contents.get(appId),
    dispose: () => {
      if (disposed) return
      disposed = true
      runtime.dispose()
      contents.clear()
      workspace.dispose()
    },
  }
}
export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
