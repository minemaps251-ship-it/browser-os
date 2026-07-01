import { createElement, type ReactElement } from 'react'
import { createRegistry } from '../core/applications/registry'
import type { ProcessId, WindowId } from '../core/shared/ids'
import { createRuntime } from '../core/runtime/service'
import { temporaryWorkspace, type Workspace } from './workspace'
import { createFileOpeningService } from '../core/applications/fileOpening'
import { builtInApps, type AppRegistration } from './builtInApps'

export function createBrowserRuntime(
  registrations: readonly AppRegistration[] = builtInApps,
  workspace: Workspace = temporaryWorkspace(),
) {
  const registry = createRegistry(registrations.map((entry) => entry.manifest))
  const entries = new Map(
    registrations.map((entry) => [entry.manifest.id, entry]),
  )
  const contents = new Map<ProcessId, ReactElement>()
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
    load: async (appId, scope, context) => {
      const entry = entries.get(appId)
      if (!entry) throw new Error('Missing application renderer')
      const module = await entry.load()
      if (!scope.signal.aborted) {
        if (context.input.kind === 'file') {
          const file = await workspace.vfs.stat(context.input.fileId)
          if (!file.ok || file.value.kind !== 'file')
            throw new Error('File is unavailable')
        }
        if (scope.signal.aborted) return
        contents.set(
          context.processId,
          createElement(module.default, {
            launchInput: context.input,
            processId: context.processId,
          }),
        )
        scope.registerCleanup(() => {
          contents.delete(context.processId)
        })
      }
    },
    onCleanupError: (error) => {
      console.error('Application cleanup failed', error)
    },
  })
  const fileOpening = createFileOpeningService(runtime, workspace.vfs)
  let disposed = false
  return {
    ...runtime,
    vfs: workspace.vfs,
    settings: workspace.settings,
    refresh: workspace.refresh,
    storageMode: workspace.mode,
    getContent: (processId: ProcessId) => contents.get(processId),
    openFile: fileOpening.openFile,
    dispose: () => {
      if (disposed) return
      disposed = true
      fileOpening.dispose()
      runtime.dispose()
      contents.clear()
      workspace.dispose()
    },
  }
}
export type BrowserRuntime = ReturnType<typeof createBrowserRuntime>
