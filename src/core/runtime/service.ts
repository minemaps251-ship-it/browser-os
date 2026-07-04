import type { NodeId } from '../filesystem/types'
import type { ApplicationLaunchInput } from '../applications/launchInput'
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
  readonly documentFileId: NodeId | null
  readonly launchInput: ApplicationLaunchInput
}
export type LaunchResult =
  | { ok: true; windowId: WindowId; processId: ProcessId }
  | { ok: false; message: string }
interface Dependencies {
  registry: ApplicationRegistry
  ids: IdFactory
  now: () => number
  getUsableArea: () => Size
  load: (
    appId: AppId,
    scope: ProcessScope,
    context: {
      readonly processId: ProcessId
      readonly input: ApplicationLaunchInput
    },
  ) => Promise<void>
  onCleanupError: (error: unknown) => void
}

// Bound file requests that arrive before a lazy app mounts its receiver.
const MAX_QUEUED_FILES = 16

export function createRuntime(deps: Dependencies) {
  const windows = createWindowService()
  const processes = new Map<ProcessId, Process>()
  const scopes = new Map<ProcessId, ProcessScope>()
  const pending = new Map<AppId, Promise<LaunchResult>>()
  const closeGuards = new Map<ProcessId, () => Promise<boolean>>()
  const closing = new Map<WindowId, Promise<boolean>>()
  const fileReceivers = new Map<ProcessId, (fileId: NodeId) => boolean>()
  const fileInbox = new Map<ProcessId, Set<NodeId>>()
  let disposed = false
  function deliverFile(processId: ProcessId, fileId: NodeId): boolean {
    const process = processes.get(processId)
    if (
      disposed ||
      process?.status !== 'running' ||
      deps.registry.get(process.appId)?.fileOpenPolicy !== 'reuse-window'
    )
      return false
    const receiver = fileReceivers.get(processId)
    if (receiver) {
      try {
        return receiver(fileId)
      } catch {
        return false
      }
    }
    const inbox = fileInbox.get(processId) ?? new Set<NodeId>()
    if (inbox.size >= MAX_QUEUED_FILES && !inbox.has(fileId)) return false
    inbox.add(fileId)
    fileInbox.set(processId, inbox)
    return true
  }
  function forgetReceiver(processId: ProcessId) {
    fileReceivers.delete(processId)
    fileInbox.delete(processId)
  }

  async function start(
    appId: AppId,
    launchInput: ApplicationLaunchInput,
  ): Promise<LaunchResult> {
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
      launchInput,
      documentFileId: launchInput.kind === 'file' ? launchInput.fileId : null,
    })
    scopes.set(processId, scope)
    try {
      await deps.load(appId, scope, { processId, input: launchInput })
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
        launchInput,
        documentFileId: launchInput.kind === 'file' ? launchInput.fileId : null,
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
  function launch(
    appId: AppId,
    input: ApplicationLaunchInput = { kind: 'default' },
  ): Promise<LaunchResult> {
    if (disposed)
      return Promise.resolve({ ok: false, message: 'BrowserOS is stopped.' })
    const manifest = deps.registry.get(appId)
    if (input.kind === 'file' && manifest?.instancePolicy !== 'multiple')
      return Promise.resolve({
        ok: false,
        message: 'Application does not accept file launches.',
      })
    if (
      manifest?.instancePolicy === 'singleton' ||
      manifest?.fileOpenPolicy === 'reuse-window'
    ) {
      const existing = Object.values(windows.read.getState().byId).find(
        (window) =>
          window?.appId === appId &&
          processes.get(window.processId)?.status !== 'crashed',
      )
      if (existing) {
        if (
          input.kind === 'file' &&
          !deliverFile(existing.processId, input.fileId)
        )
          return Promise.resolve({
            ok: false,
            message:
              'Finish closing documents or close a tab before opening another file.',
          })
        windows.restore(existing.id)
        return Promise.resolve({
          ok: true,
          windowId: existing.id,
          processId: existing.processId,
        })
      }
      const starting = pending.get(appId)
      if (starting)
        return input.kind === 'file' &&
          manifest.fileOpenPolicy === 'reuse-window'
          ? starting.then((result) =>
              result.ok && !deliverFile(result.processId, input.fileId)
                ? {
                    ok: false,
                    message:
                      'The file could not be delivered to the application.',
                  }
                : result,
            )
          : starting
    }
    const launchInput: ApplicationLaunchInput = Object.freeze(
      input.kind === 'file'
        ? { kind: 'file', fileId: input.fileId }
        : { kind: 'default' },
    )
    const promise = start(appId, launchInput)
    if (
      manifest?.instancePolicy === 'singleton' ||
      manifest?.fileOpenPolicy === 'reuse-window'
    ) {
      pending.set(appId, promise)
      void promise.finally(() => {
        if (pending.get(appId) === promise) pending.delete(appId)
      })
    }
    return promise
  }
  function closeWindow(id: WindowId) {
    const window = windows.read.getState().byId[id]
    if (!window) return
    closeGuards.delete(window.processId)
    forgetReceiver(window.processId)
    closing.delete(id)
    windows.remove(id)
    scopes.get(window.processId)?.dispose()
    scopes.delete(window.processId)
    processes.delete(window.processId)
  }
  function requestCloseWindow(id: WindowId): Promise<boolean> | undefined {
    const window = windows.read.getState().byId[id]
    if (!window || disposed) return
    const guard = closeGuards.get(window.processId)
    if (!guard) {
      closeWindow(id)
      return
    }
    const pendingClose = closing.get(id)
    if (pendingClose) return pendingClose
    windows.restore(id)
    // Defer invocation so reentrant close requests share the same promise.
    const pendingCloseResult = Promise.resolve()
      .then(guard)
      .then(
        (allow) => {
          if (
            allow &&
            !disposed &&
            closeGuards.get(window.processId) === guard &&
            windows.read.getState().byId[id]?.processId === window.processId
          ) {
            closeWindow(id)
            return true
          }
          return false
        },
        () => false,
      )
      .finally(() => {
        if (closing.get(id) === pendingCloseResult) closing.delete(id)
      })
    closing.set(id, pendingCloseResult)
    return pendingCloseResult
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
    registerCloseGuard: (
      processId: ProcessId,
      guard: () => Promise<boolean>,
    ) => {
      if (disposed || !processes.has(processId)) return () => {}
      if (closeGuards.has(processId))
        throw new Error('A close guard is already registered.')
      closeGuards.set(processId, guard)
      return () => {
        if (closeGuards.get(processId) === guard) closeGuards.delete(processId)
      }
    },
    registerFileReceiver: (
      processId: ProcessId,
      receiver: (id: NodeId) => boolean,
    ) => {
      const process = processes.get(processId)
      if (
        disposed ||
        process?.status !== 'running' ||
        deps.registry.get(process.appId)?.fileOpenPolicy !== 'reuse-window'
      )
        return () => {}
      if (fileReceivers.has(processId))
        throw new Error('A file receiver is already registered.')
      fileReceivers.set(processId, receiver)
      const inbox = fileInbox.get(processId)
      fileInbox.delete(processId)
      inbox?.forEach((id) => receiver(id))
      return () => {
        if (fileReceivers.get(processId) === receiver)
          fileReceivers.delete(processId)
      }
    },
    bindProcessDocument: (processId: ProcessId, fileId: NodeId | null) => {
      const process = processes.get(processId)
      const manifest = process && deps.registry.get(process.appId)
      if (
        disposed ||
        !process ||
        process.status !== 'running' ||
        !manifest?.fileAssociations?.length
      )
        return false
      processes.set(processId, { ...process, documentFileId: fileId })
      return true
    },
    listProcesses: () => [...processes.values()],
    reportCrash(id: WindowId) {
      const window = windows.read.getState().byId[id]
      if (!window) return
      const process = processes.get(window.processId)
      if (process) processes.set(process.id, { ...process, status: 'crashed' })
      closeGuards.delete(window.processId)
      forgetReceiver(window.processId)
      closing.delete(id)
      scopes.get(window.processId)?.dispose()
    },
    dispose() {
      if (disposed) return
      disposed = true
      scopes.forEach((scope) => scope.dispose())
      scopes.clear()
      fileReceivers.clear()
      fileInbox.clear()
      closeGuards.clear()
      closing.clear()
      for (const id of windows.read.getState().order) windows.remove(id)
      processes.clear()
      pending.clear()
    },
  }
}
export type Runtime = ReturnType<typeof createRuntime>
