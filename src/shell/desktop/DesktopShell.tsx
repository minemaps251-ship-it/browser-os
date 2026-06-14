import { useState } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import type { AppId } from '../../core/shared/ids'
import { WindowLayer } from '../windows/WindowLayer'
import { Taskbar } from '../taskbar/Taskbar'
import { focusWindowElement } from '../windows/focus'

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
    <main className="desktop">
      <header className="desktop-header">
        <div className="identity">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <div>
            <h1>BrowserOS</h1>
            <p>A workspace in your browser</p>
          </div>
        </div>
        <nav aria-label="Application launcher">
          {runtime.registry.list().map((app, index) => (
            <button
              id={index === 0 ? 'app-launcher' : undefined}
              key={app.id}
              disabled={pending !== null}
              onClick={() => {
                void launch(app.id)
              }}
            >
              <span aria-hidden="true">{app.icon}</span> Open {app.name}
            </button>
          ))}
        </nav>
      </header>
      {pending && (
        <p className="desktop-status" role="status">
          Opening application…
        </p>
      )}
      {error && (
        <p className="desktop-status" role="alert">
          {error}
        </p>
      )}
      <div className="desktop-workspace">
        <div className="desktop-hint" aria-hidden="true">
          <span>YOUR SPACE TO EXPLORE</span>
          <strong>Start with a window.</strong>
          <p>Open About BrowserOS to discover the workspace.</p>
        </div>
        <WindowLayer />
      </div>
      <Taskbar />
    </main>
  )
}
