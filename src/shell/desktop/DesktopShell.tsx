import { MenuBar } from './MenuBar'
import { useDesktopPreferences } from './useDesktopPreferences'
import { useShellShortcuts } from '../commands/useShellShortcuts'
import { PopupMenu, type MenuAnchor } from '../menu/PopupMenu'
import styles from './DesktopShell.module.css'
import { useState } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import type { AppId } from '../../core/shared/ids'
import { WindowLayer } from '../windows/WindowLayer'
import { Taskbar } from '../taskbar/Taskbar'
import { focusWindowElement } from '../windows/focus'
import { RefreshControl } from './RefreshControl'
import { ThemeControl } from './ThemeControl'
import { DesktopClock } from './DesktopClock'
import { DesktopWallpaper } from './DesktopWallpaper'

export function DesktopShell() {
  const runtime = useRuntime()
  useShellShortcuts()
  const preferences = useDesktopPreferences()
  const [context, setContext] = useState<MenuAnchor | null>(null)
  const [dismissContext, setDismissContext] = useState<() => void>(
    () => () => {},
  )
  const apps = [...runtime.registry.list()]
  if (preferences.value.shortcutOrder === 'name')
    apps.sort((a, b) => a.name.localeCompare(b.name))
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
    <main
      className={styles.desktop}
      data-wallpaper={preferences.value.wallpaper}
      data-reduce-motion={preferences.value.reduceMotion}
    >
      <DesktopWallpaper />
      <header className={styles.header}>
        <MenuBar />
        <div className={styles.systemControls}>
          <RefreshControl refresh={runtime.refresh} />
          <ThemeControl settings={runtime.settings} />
          <DesktopClock />
        </div>
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
      <div
        id="desktop-workspace"
        className={styles.workspace}
        onContextMenu={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest(
              'section[aria-label], button, input, textarea, dialog',
            )
          )
            return
          event.preventDefault()
          const previous = document.activeElement
          setDismissContext(() => () => {
            setContext(null)
            if (previous instanceof HTMLElement && previous.isConnected)
              previous.focus()
          })
          setContext({ x: event.clientX, y: event.clientY })
        }}
      >
        {context && (
          <PopupMenu
            label="Desktop actions"
            anchor={context}
            onClose={dismissContext}
            items={[
              {
                id: 'wallpaper',
                label:
                  preferences.value.wallpaper === 'warm'
                    ? 'Use cool wallpaper'
                    : 'Use warm wallpaper',
                disabled: preferences.busy,
                run: () => {
                  void runtime.preferences.update({
                    wallpaper:
                      preferences.value.wallpaper === 'warm' ? 'cool' : 'warm',
                  })
                },
              },
              {
                id: 'sort',
                label: 'Arrange shortcuts by name',
                disabled: preferences.busy,
                run: () => {
                  void runtime.preferences.update({ shortcutOrder: 'name' })
                },
              },
              {
                id: 'settings',
                label: 'Desktop settings…',
                run: () => {
                  void launch('settings' as AppId)
                },
              },
            ]}
          />
        )}
        <nav className={styles.shortcuts} aria-label="Application launcher">
          {apps.map((app, index) => (
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
      {preferences.loaded && preferences.busy && (
        <p className={styles.preferenceStatus} role="status">
          Saving desktop preferences…
        </p>
      )}
      {preferences.error && (
        <p className={styles.preferenceStatus} role="alert">
          {preferences.error}
        </p>
      )}
      <Taskbar />
    </main>
  )
}
