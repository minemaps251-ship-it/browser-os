import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ApplicationLaunchInput } from '../../core/applications/launchInput'
import { useRuntime } from '../../app/runtimeContext'
import { createNotesSession } from './session'
export function useNotesDocument(input: ApplicationLaunchInput) {
  const runtime = useRuntime()
  // Launch input is immutable for the lifetime of this process.
  const [session] = useState(() =>
    createNotesSession(
      runtime.vfs,
      runtime.refresh,
      input.kind === 'file' ? input.fileId : null,
    ),
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  useEffect(() => {
    session.start()
    return session.stop
  }, [session])
  return { snapshot, retry: session.retry }
}
