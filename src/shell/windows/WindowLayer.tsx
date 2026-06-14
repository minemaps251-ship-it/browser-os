import { useStore } from 'zustand'
import { useRuntime } from '../../app/runtimeContext'
import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const runtime = useRuntime()
  const ids = useStore(runtime.windows, (state) => state.byId)
  // Object insertion order stays stable when only stacking order changes.
  return (
    <div className="window-layer" aria-label="Application windows">
      {Object.keys(ids).map((id) => (
        <WindowFrame key={id} id={id as keyof typeof ids} />
      ))}
    </div>
  )
}
