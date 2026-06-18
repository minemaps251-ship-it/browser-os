import type { Position } from '../windows/geometry'
import type { ApplicationRegistry } from '../applications/registry'
import type { Size } from '../shared/geometry'
import { createProcessScope, type ProcessScope } from '../processes/scope'
import type { AppId, IdFactory, ProcessId, WindowId } from '../shared/ids'
import {
  createWindowService,
  initialBounds,
  type Bounds,
} from '../windows/service'

export interface Process {
  readonly id: ProcessId
  readonly appId: AppId
  readonly status: 'starting' | 'running' | 'crashed'
  readonly startedAt: number
}
export type LaunchResult =
  | { ok: true; windowId: WindowId; processId: ProcessId }
  | { ok: false; message: string }
interface Dependencies {
  registry: ApplicationRegistry
  ids: IdFactory
  now: () => number
  getUsableArea: () => Size
  load: (appId: AppId, scope: ProcessScope) => Promise<void>
  onCleanupError: (error: unknown) => void
}

export function createRuntime(deps: Dependencies) {
  const windows = createWindowService()
  const processes = new Map<ProcessId, Process>()
  const scopes = new Map<ProcessId, ProcessScope>()
  const pending = new Map<AppId, Promise<LaunchResult>>()
  let disposed = false

  async function start(appId: AppId): Promise<LaunchResult> {
    const manifest = deps.registry.get(appId)
    if (!manifest || disposed)
      return { ok: false, message: 'Application is unavailable.' }
    const processId = deps.ids.process()
    const scope = createProcessScope(deps.onCleanupError)
    const startedAt = deps.now()
    processes.set(processId, {
      id: processId,
      appId,
      status: 'starting',
      startedAt,
    })
    scopes.set(processId, scope)
    try {
      await deps.load(appId, scope)
      if (disposed || scope.signal.aborted)
        throw new Error('Application launch was cancelled.')
      const windowId = deps.ids.window()
      windows.open({
        id: windowId,
        appId,
        processId,
        title: manifest.name,
        status: 'visible',
        placement: { kind: 'normal' },
        bounds: initialBounds(
          manifest.window.defaultSize,
          deps.getUsableArea(),
          windows.read.getState().order.length,
        ),
      })
      processes.set(processId, {
        id: processId,
        appId,
        status: 'running',
        startedAt,
      })
      return { ok: true, windowId, processId }
    } catch {
      scope.dispose()
      scopes.delete(processId)
      processes.delete(processId)
      return {
        ok: false,
        message: disposed
          ? 'BrowserOS is stopped.'
          : `Could not open ${manifest.name}. Try again.`,
      }
    }
  }
  function launch(appId: AppId): Promise<LaunchResult> {
    if (disposed)
      return Promise.resolve({ ok: false, message: 'BrowserOS is stopped.' })
    const manifest = deps.registry.get(appId)
    if (manifest?.instancePolicy === 'singleton') {
      const existing = Object.values(windows.read.getState().byId).find(
        (window) => window?.appId === appId,
      )
      if (existing) {
        windows.restore(existing.id)
        return Promise.resolve({
          ok: true,
          windowId: existing.id,
          processId: existing.processId,
        })
      }
      const starting = pending.get(appId)
      if (starting) return starting
    }
    const promise = start(appId)
    if (manifest?.instancePolicy === 'singleton') {
      pending.set(appId, promise)
      void promise.finally(() => {
        if (pending.get(appId) === promise) pending.delete(appId)
      })
    }
    return promise
  }
  function requestCloseWindow(id: WindowId) {
    const window = windows.read.getState().byId[id]
    if (!window) return
    windows.remove(id)
    scopes.get(window.processId)?.dispose()
    scopes.delete(window.processId)
    processes.delete(window.processId)
  }
  return {
    registry: deps.registry,
    windows: windows.read,
    launch,
    focusWindow: (id: WindowId) => {
      if (!disposed) windows.focus(id)
    },
    minimizeWindow: (id: WindowId) => {
      if (!disposed) windows.minimize(id)
    },
    restoreWindow: (id: WindowId) => {
      if (!disposed) windows.restore(id)
    },
    moveWindow: (id: WindowId, position: Position, area: Size) => {
      if (!disposed) windows.move(id, position, area)
    },
    resizeWindow: (id: WindowId, bounds: Bounds, area: Size) => {
      if (disposed) return
      const window = windows.read.getState().byId[id]
      const manifest = window && deps.registry.get(window.appId)
      if (manifest) windows.resize(id, bounds, manifest.window.minSize, area)
    },
    maximizeWindow: (id: WindowId) => {
      if (!disposed) windows.maximize(id, deps.getUsableArea())
    },
    restoreWindowBounds: (id: WindowId) => {
      if (disposed) return
      const window = windows.read.getState().byId[id]
      const manifest = window && deps.registry.get(window.appId)
      if (manifest)
        windows.restoreBounds(id, manifest.window.minSize, deps.getUsableArea())
    },
    fitWindowToArea: (id: WindowId, area: Size) => {
      if (disposed) return
      const window = windows.read.getState().byId[id]
      const manifest = window && deps.registry.get(window.appId)
      if (manifest) windows.fitToArea(id, manifest.window.minSize, area)
    },
    requestCloseWindow,
    listProcesses: () => [...processes.values()],
    reportCrash(id: WindowId) {
      const window = windows.read.getState().byId[id]
      if (!window) return
      const process = processes.get(window.processId)
      if (process) processes.set(process.id, { ...process, status: 'crashed' })
      scopes.get(window.processId)?.dispose()
    },
    dispose() {
      if (disposed) return
      disposed = true
      scopes.forEach((scope) => scope.dispose())
      scopes.clear()
      for (const id of windows.read.getState().order) windows.remove(id)
      processes.clear()
      pending.clear()
    },
  }
}
export type Runtime = ReturnType<typeof createRuntime>
