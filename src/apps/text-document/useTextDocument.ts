import { useEffect, useState } from 'react'
import { useDocumentControls } from './useDocumentControls'
import type { ApplicationProps } from '../../app/builtInApps'
import { useRuntime } from '../../app/runtimeContext'
import type { AppId } from '../../core/shared/ids'
import { createTextDocumentSession } from './session'
export function useTextDocument(
  { launchInput: input, processId }: ApplicationProps,
  appId: AppId,
) {
  const runtime = useRuntime()
  // Launch input is immutable for the lifetime of this process.
  const [session] = useState(() =>
    createTextDocumentSession(
      runtime.vfs,
      runtime.refresh,
      input.kind === 'file' ? input.fileId : null,
      (id) => {
        runtime.bindProcessDocument(processId, id)
      },
    ),
  )
  useEffect(() => {
    session.start()
    return session.stop
  }, [session])
  useEffect(
    () => runtime.registerCloseGuard(processId, session.requestClose),
    [runtime, processId, session],
  )
  return useDocumentControls(session, () => void runtime.launch(appId))
}
