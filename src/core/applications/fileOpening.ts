import type { Runtime, LaunchResult } from '../runtime/service'
import type { VirtualFileSystem } from '../filesystem/service'
import type { NodeId } from '../filesystem/types'
import type { AppId } from '../shared/ids'
export type FileOpenResult =
  | Extract<LaunchResult, { ok: true }>
  | {
      readonly ok: false
      readonly code:
        | 'NOT_FOUND'
        | 'NOT_FILE'
        | 'READ_FAILED'
        | 'UNSUPPORTED'
        | 'LAUNCH_FAILED'
        | 'STOPPED'
      readonly message: string
    }
export function createFileOpeningService(
  runtime: Pick<
    Runtime,
    'registry' | 'launch' | 'windows' | 'listProcesses' | 'restoreWindow'
  >,
  vfs: Pick<VirtualFileSystem, 'stat'>,
) {
  const pending = new Map<string, Promise<FileOpenResult>>()
  const launching = new Map<string, Promise<LaunchResult>>()
  let stopped = false
  async function open(
    id: NodeId,
    requestedApp?: AppId,
  ): Promise<FileOpenResult> {
    if (stopped)
      return { ok: false, code: 'STOPPED', message: 'BrowserOS is stopped.' }
    try {
      const node = await vfs.stat(id)
      if (stopped)
        return { ok: false, code: 'STOPPED', message: 'BrowserOS is stopped.' }
      if (!node.ok)
        return {
          ok: false,
          code: node.error.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'READ_FAILED',
          message:
            node.error.code === 'NOT_FOUND'
              ? 'This file is no longer available.'
              : 'This file could not be read. Please try again.',
        }
      if (node.value.kind !== 'file')
        return {
          ok: false,
          code: 'NOT_FILE',
          message: 'Choose a file to open.',
        }
      const mime = node.value.mime
      const handler = requestedApp
        ? runtime.registry.get(requestedApp)
        : runtime.registry.fileHandler(node.value.mime)
      if (
        !handler ||
        !handler.fileAssociations?.some((entry) => entry.mime === mime)
      )
        return {
          ok: false,
          code: 'UNSUPPORTED',
          message: requestedApp
            ? 'The requested application cannot open this file type.'
            : 'No default application is available for this file type yet.',
        }
      const appId: AppId = handler.id
      const existing = runtime
        .listProcesses()
        .find(
          (process) =>
            process.appId === appId &&
            process.status === 'running' &&
            process.documentFileId === id,
        )
      const window =
        existing &&
        Object.values(runtime.windows.getState().byId).find(
          (window) => window?.processId === existing.id,
        )
      if (window) {
        runtime.restoreWindow(window.id)
        return { ok: true, windowId: window.id, processId: window.processId }
      }
      // Default and explicit requests can resolve to the same handler.
      const launchKey = JSON.stringify([id, appId])
      let operation = launching.get(launchKey)
      if (!operation) {
        operation = runtime.launch(appId, { kind: 'file', fileId: id })
        launching.set(launchKey, operation)
        const captured = operation
        void operation.finally(() => {
          if (launching.get(launchKey) === captured) launching.delete(launchKey)
        })
      }
      const result = await operation
      if (stopped)
        return { ok: false, code: 'STOPPED', message: 'BrowserOS is stopped.' }
      return result.ok
        ? result
        : { ok: false, code: 'LAUNCH_FAILED', message: result.message }
    } catch {
      return {
        ok: false,
        code: 'READ_FAILED',
        message: 'This file could not be opened. Please try again.',
      }
    }
  }
  return {
    openFile: (id: NodeId, requestedApp?: AppId): Promise<FileOpenResult> => {
      const key = JSON.stringify([id, requestedApp ?? null])
      const previous = pending.get(key)
      if (previous) return previous
      const operation = open(id, requestedApp)
      pending.set(key, operation)
      void operation.finally(() => {
        if (pending.get(key) === operation) pending.delete(key)
      })
      return operation
    },
    dispose: () => {
      stopped = true
      pending.clear()
      launching.clear()
    },
  }
}
