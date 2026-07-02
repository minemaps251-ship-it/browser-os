import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import type { ApplicationProps } from '../../app/builtInApps'
import { useRuntime } from '../../app/runtimeContext'
import { notesManifest } from './manifest'
import { createNotesSession } from './session'
export function useNotesDocument({
  launchInput: input,
  processId,
}: ApplicationProps) {
  const runtime = useRuntime()
  const composing = useRef(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  // Launch input is immutable for the lifetime of this process.
  const [session] = useState(() =>
    createNotesSession(
      runtime.vfs,
      runtime.refresh,
      input.kind === 'file' ? input.fileId : null,
      (id) => {
        runtime.bindProcessDocument(processId, id)
      },
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
  function save() {
    if (snapshot.status === 'ready' && !snapshot.fileId) setSaveAsOpen(true)
    else void session.save()
  }
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
          save()
      }
    },
    retry: session.retry,
    edit: session.edit,
    save,
    newDocument: () => void runtime.launch(notesManifest.id),
    saveAsOpen,
    openSaveAs: () => setSaveAsOpen(true),
    cancelSaveAs: () => setSaveAsOpen(false),
    saveAs: session.saveAs,
    savedAs: () => {
      setSaveAsOpen(false)
      if (session.getSnapshot().status === 'ready') void session.saveAndClose()
    },
    discardAndReload: session.discardAndReload,
    cancelClose: session.cancelClose,
    discardClose: session.discardClose,
    saveAndClose: () => {
      if (snapshot.status === 'ready' && !snapshot.fileId) setSaveAsOpen(true)
      else void session.saveAndClose()
    },
  }
}
