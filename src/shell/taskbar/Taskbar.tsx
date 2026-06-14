import styles from './Taskbar.module.css'
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { useRuntime } from '../../app/runtimeContext'
import type { WindowId } from '../../core/shared/ids'
import { focusWindowElement } from '../windows/focus'

export function Taskbar() {
  const runtime = useRuntime()
  const windows = useStore(runtime.windows, (state) => state.byId)
  const focusedId = useStore(runtime.windows, (state) => state.focusedId)
  const previousFocus = useRef<WindowId | null>(focusedId)
  useEffect(() => {
    if (previousFocus.current && !focusedId)
      document.getElementById('app-launcher')?.focus()
    previousFocus.current = focusedId
  }, [focusedId])
  return (
    <footer className={styles.taskbar}>
      <span className={styles.label}>WORKSPACE</span>
      <nav aria-label="Running applications">
        {Object.values(windows).map(
          (window) =>
            window && (
              <button
                key={window.id}
                aria-pressed={window.id === focusedId}
                onClick={() => {
                  runtime.focusWindow(window.id)
                  focusWindowElement(window.id)
                }}
              >
                {window.title}
              </button>
            ),
        )}
        {Object.keys(windows).length === 0 && (
          <span className={styles.empty}>No applications running</span>
        )}
      </nav>
      <span className={styles.session}>LOCAL SESSION</span>
    </footer>
  )
}
