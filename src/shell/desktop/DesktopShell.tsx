import styles from './DesktopShell.module.css'
import { useState } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import type { AppId } from '../../core/shared/ids'
import { WindowLayer } from '../windows/WindowLayer'
import { Taskbar } from '../taskbar/Taskbar'
import { focusWindowElement } from '../windows/focus'
import { DesktopClock } from './DesktopClock'
import { DesktopWallpaper } from './DesktopWallpaper'

export function DesktopShell() {
  const runtime = useRuntime()
  const [pending, setPending] = useState<AppId | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function launch(id: AppId) {
    setPending(id)
    setError(null)
    const result = await runtime.launch(id)
    setPending(null)
    if (!result.ok) setError(result.message)
    else focusWindowElement(result.windowId)
  }
  return (
    <main className={styles.desktop}>
      <DesktopWallpaper />
      <header className={styles.header}>
        <div className={styles.identity}>
          <svg className={styles.brand} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" rx="2" />
            <rect x="14" y="3" width="7" height="7" rx="2" />
            <rect x="3" y="14" width="7" height="7" rx="2" />
            <path d="M14 14h7v7h-7z" />
          </svg>
          <h1>BrowserOS</h1>
          <span className={styles.location}>Desktop</span>
        </div>
        <DesktopClock />
      </header>
      {runtime.storageMode === 'temporary' && (
        <p className={styles.status} role="status">
          Temporary workspace — files will be lost when you reload.
        </p>
      )}
      {pending && (
        <p className={styles.status} role="status">
          Opening application…
        </p>
      )}
      {error && (
        <p className={styles.status} role="alert">
          {error}
        </p>
      )}
      <div id="desktop-workspace" className={styles.workspace}>
        <nav className={styles.shortcuts} aria-label="Application launcher">
          {runtime.registry.list().map((app, index) => (
            <button
              className={styles.shortcut}
              aria-label={`Open ${app.name}`}
              id={index === 0 ? 'app-launcher' : undefined}
              key={app.id}
              disabled={pending !== null}
              onClick={() => {
                void launch(app.id)
              }}
            >
              <span className={styles.appIcon} aria-hidden="true">
                {app.icon}
              </span>
              <span className={styles.appLabel}>{app.name}</span>
            </button>
          ))}
        </nav>
        <WindowLayer />
      </div>
      <Taskbar />
    </main>
  )
}
