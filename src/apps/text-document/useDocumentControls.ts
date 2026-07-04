import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import { useUnsavedWarning } from './useUnsavedWarning'
import type { createTextDocumentSession } from './session'
export function useDocumentControls(
  session: ReturnType<typeof createTextDocumentSession>,
  newDocument: () => void,
  {
    onModalChange,
    warnOnExit = true,
  }: {
    onModalChange?: (open: boolean) => void
    warnOnExit?: boolean
  } = {},
) {
  const composing = useRef(false)
  const [saveAsOpen, setOpen] = useState(false)
  function setSaveAsOpen(open: boolean) {
    onModalChange?.(open)
    setOpen(open)
  }
  useEffect(
    () => () => {
      onModalChange?.(false)
    },
    [onModalChange],
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const needsWarning =
    snapshot.status === 'ready' && (snapshot.dirty || snapshot.saving)
  useUnsavedWarning(warnOnExit && needsWarning)
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
    onEditorKeyDown: (event: KeyboardEvent<HTMLElement>) => {
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
    newDocument,
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
