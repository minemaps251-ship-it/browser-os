import styles from './WindowLayer.module.css'
import { useStore } from 'zustand'
import { useRuntime } from '../../app/runtimeContext'
import { WindowFrame } from './WindowFrame'

export function WindowLayer() {
  const runtime = useRuntime()
  const ids = useStore(runtime.windows, (state) => state.ids)
  // Object insertion order stays stable when only stacking order changes.
  return (
    <div className={styles.layer} aria-label="Application windows">
      {ids.map((id) => (
        <WindowFrame key={id} id={id} />
      ))}
    </div>
  )
}
