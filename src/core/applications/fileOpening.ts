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
  const pending = new Map<NodeId, Promise<FileOpenResult>>()
  let stopped = false
  async function open(id: NodeId): Promise<FileOpenResult> {
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
      const handler = runtime.registry.fileHandler(node.value.mime)
      if (!handler)
        return {
          ok: false,
          code: 'UNSUPPORTED',
          message:
            'No default application is available for this file type yet.',
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
      const result = await runtime.launch(appId, { kind: 'file', fileId: id })
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
    openFile: (id: NodeId): Promise<FileOpenResult> => {
      const previous = pending.get(id)
      if (previous) return previous
      const operation = open(id)
      pending.set(id, operation)
      void operation.finally(() => {
        if (pending.get(id) === operation) pending.delete(id)
      })
      return operation
    },
    dispose: () => {
      stopped = true
      pending.clear()
    },
  }
}
