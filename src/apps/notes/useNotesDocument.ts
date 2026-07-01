import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import type { ApplicationProps } from '../../app/builtInApps'
import { useRuntime } from '../../app/runtimeContext'
import { createNotesSession } from './session'
export function useNotesDocument({
  launchInput: input,
  processId,
}: ApplicationProps) {
  const runtime = useRuntime()
  const composing = useRef(false)
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
  useEffect(
    () => runtime.registerCloseGuard(processId, session.requestClose),
    [runtime, processId, session],
  )
  const needsWarning =
    snapshot.status === 'ready' && (snapshot.dirty || snapshot.saving)
  useEffect(() => {
    if (!needsWarning) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [needsWarning])
  return {
    snapshot,
    onCompositionStart: () => {
      composing.current = true
    },
    onCompositionEnd: () => {
      composing.current = false
    },
    onEditorKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()
        if (
          !composing.current &&
          !event.nativeEvent.isComposing &&
          event.nativeEvent.keyCode !== 229
        )
          void session.save()
      }
    },
    retry: session.retry,
    edit: session.edit,
    save: session.save,
    discardAndReload: session.discardAndReload,
    cancelClose: session.cancelClose,
    discardClose: session.discardClose,
    saveAndClose: session.saveAndClose,
  }
}
