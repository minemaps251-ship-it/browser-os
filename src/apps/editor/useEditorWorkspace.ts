import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ApplicationProps } from '../../app/builtInApps'
import { useRuntime } from '../../app/runtimeContext'
import { useUnsavedWarning } from '../text-document/useUnsavedWarning'
import { createEditorWorkspace } from './workspace'
export function useEditorWorkspace({
  processId,
  launchInput,
}: ApplicationProps) {
  const runtime = useRuntime()
  const [workspace] = useState(() =>
    createEditorWorkspace(
      runtime.vfs,
      runtime.refresh,
      launchInput.kind === 'file' ? launchInput.fileId : null,
    ),
  )
  const snapshot = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  )
  useEffect(() => {
    workspace.start()
    return workspace.stop
  }, [workspace])
  useEffect(
    () => runtime.registerFileReceiver(processId, workspace.openFile),
    [runtime, processId, workspace],
  )
  useEffect(
    () => runtime.registerCloseGuard(processId, workspace.requestCloseWindow),
    [runtime, processId, workspace],
  )
  const currentFile =
    snapshot.tabs.find((tab) => tab.id === snapshot.activeId)?.fileId ?? null
  useEffect(() => {
    runtime.bindProcessDocument(processId, currentFile)
  }, [runtime, processId, currentFile])
  useUnsavedWarning(
    snapshot.tabs.some(
      (tab) =>
        tab.document.status === 'ready' &&
        (tab.document.dirty || tab.document.saving),
    ),
  )
  return { workspace, snapshot }
}
