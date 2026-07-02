import { useEffect, useState, useRef, useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { createDirectorySession } from '../files/session'
import type { NodeId, VfsResult } from '../../core/filesystem/types'
import { createErrorMessage } from '../files/createError'
export function useSaveAsDestination(
  initialName: string,
  save: (parent: NodeId, name: string) => Promise<VfsResult<NodeId>>,
  onSaved: () => void,
) {
  const runtime = useRuntime()
  const [session] = useState(() =>
    createDirectorySession(runtime.vfs, runtime.refresh),
  )
  const directory = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [name, setName] = useState(initialName)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(false),
    submitting = useRef(false)
  useEffect(() => {
    active.current = true
    session.start()
    return () => {
      active.current = false
      session.stop()
    }
  }, [session])
  return {
    directory,
    name,
    setName,
    pending,
    error,
    navigate: session.navigate,
    home: session.home,
    up: () => {
      const parent = directory.breadcrumbs.at(-2)
      if (parent) void session.navigate(parent.id)
    },
    retry: session.reload,
    submit: async () => {
      if (
        submitting.current ||
        directory.status !== 'ready' ||
        !directory.directoryId
      )
        return
      submitting.current = true
      setPending(true)
      setError(null)
      const parent = directory.directoryId,
        capturedName = name
      try {
        const result = await save(parent, capturedName)
        if (!active.current) return
        if (result.ok) onSaved()
        else setError(createErrorMessage(result.error.code))
      } catch {
        if (active.current)
          setError('The file could not be saved. Your text has been kept.')
      } finally {
        submitting.current = false
        if (active.current) setPending(false)
      }
    },
  }
}
