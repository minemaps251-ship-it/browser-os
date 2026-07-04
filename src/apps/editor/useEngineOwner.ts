import { useEffect, useRef, useState } from 'react'
import type { EditorWorkspace } from './workspace'
import { createEngineOwner } from './engine/owner'
export function useEngineOwner(workspace: EditorWorkspace) {
  const [owner] = useState(() => {
    const resources = createEngineOwner()
    resources.retain(workspace.getSnapshot().tabs.map((tab) => tab.id))
    return resources
  })
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    const retain = () =>
      owner.retain(workspace.getSnapshot().tabs.map((tab) => tab.id))
    retain()
    const off = workspace.subscribe(retain)
    return () => {
      off()
      alive.current = false
      // StrictMode's immediate replay retains the live owner; genuine unmount releases it.
      queueMicrotask(() => {
        if (!alive.current) owner.dispose()
      })
    }
  }, [workspace, owner])
  return owner
}
