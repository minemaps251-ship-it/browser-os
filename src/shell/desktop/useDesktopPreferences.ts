import { useEffect, useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
export function useDesktopPreferences() {
  const runtime = useRuntime()
  const snapshot = useSyncExternalStore(
    runtime.preferences.subscribe,
    runtime.preferences.getSnapshot,
  )
  useEffect(() => {
    if (!runtime.preferences.getSnapshot().loaded)
      void runtime.preferences.load()
  }, [runtime])
  return snapshot
}
