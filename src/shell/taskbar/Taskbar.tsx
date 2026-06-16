import styles from './Taskbar.module.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'zustand'
import { useRuntime } from '../../app/runtimeContext'
import type { WindowId } from '../../core/shared/ids'
import type { ApplicationManifest } from '../../core/applications/registry'
import { focusWindowElement } from '../windows/focus'

export function Taskbar() {
  const runtime = useRuntime()
  const windows = useStore(runtime.windows, (state) => state.ids)
  const focusedId = useStore(runtime.windows, (state) => state.focusedId)
  const previousFocus = useRef<WindowId | null>(focusedId)
  const [tooltip, setTooltip] = useState<string | null>(null)
  // Built-in singleton apps stay available; multi-instance apps retain each window.
  const pinned = runtime.registry
    .list()
    .filter((app) => app.instancePolicy === 'singleton')
  useEffect(() => {
    if (previousFocus.current && !focusedId)
      document.getElementById('app-launcher')?.focus()
    previousFocus.current = focusedId
  }, [focusedId])
  return (
    <footer className={styles.taskbar}>
      <nav
        aria-label="Running applications"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setTooltip(null)
        }}
      >
        {pinned.map((app) => (
          <PinnedItem key={app.id} app={app} onLabel={setTooltip} />
        ))}
        {windows.map((id) => {
          const window = runtime.windows.getState().byId[id]
          if (
            !window ||
            runtime.registry.get(window.appId)?.instancePolicy === 'singleton'
          )
            return null
          return <WindowItem key={id} id={id} onLabel={setTooltip} />
        })}
      </nav>
      {tooltip && (
        <span className={styles.tooltip} aria-hidden="true">
          {tooltip}
        </span>
      )}
    </footer>
  )
}

type LabelHandler = (label: string | null) => void

function PinnedItem({
  app,
  onLabel,
}: {
  app: ApplicationManifest
  onLabel: LabelHandler
}) {
  const runtime = useRuntime()
  const id = useStore(runtime.windows, (state) =>
    state.ids.find((id) => state.byId[id]?.appId === app.id),
  )
  const focused = useStore(
    runtime.windows,
    (state) => id !== undefined && state.focusedId === id,
  )
  const minimized = useStore(
    runtime.windows,
    (state) => id !== undefined && state.byId[id]?.status === 'minimized',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function activate() {
    setError(null)
    if (id) {
      runtime.restoreWindow(id)
      focusWindowElement(id)
      return
    }
    setPending(true)
    const result = await runtime.launch(app.id)
    setPending(false)
    if (result.ok) focusWindowElement(result.windowId)
    else setError(result.message)
  }
  return (
    <>
      <DockButton
        name={app.name}
        icon={app.icon}
        running={id !== undefined}
        focused={focused}
        minimized={minimized}
        pending={pending}
        onLabel={onLabel}
        onClick={() => {
          void activate()
        }}
      />
      {pending && (
        <span className={styles.message} role="status">
          Opening {app.name}…
        </span>
      )}
      {error && (
        <span className={styles.message} role="alert">
          {error}
        </span>
      )}
    </>
  )
}

function WindowItem({ id, onLabel }: { id: WindowId; onLabel: LabelHandler }) {
  const runtime = useRuntime()
  const title = useStore(
    runtime.windows,
    (state) => state.byId[id]?.title ?? '',
  )
  const appId = useStore(runtime.windows, (state) => state.byId[id]?.appId)
  const minimized = useStore(
    runtime.windows,
    (state) => state.byId[id]?.status === 'minimized',
  )
  const focused = useStore(runtime.windows, (state) => state.focusedId === id)
  const icon = appId && runtime.registry.get(appId)?.icon
  return (
    <DockButton
      name={title}
      icon={icon ?? '•'}
      running
      focused={focused}
      minimized={minimized}
      onLabel={onLabel}
      onClick={() => {
        runtime.restoreWindow(id)
        focusWindowElement(id)
      }}
    />
  )
}

function DockButton({
  name,
  icon,
  running,
  focused,
  minimized,
  pending = false,
  onClick,
  onLabel,
}: {
  name: string
  icon: ReactNode
  running: boolean
  focused: boolean
  minimized: boolean
  pending?: boolean
  onClick: () => void
  onLabel: LabelHandler
}) {
  return (
    <button
      aria-label={minimized ? `${name} (minimized)` : name}
      aria-pressed={focused}
      aria-busy={pending}
      disabled={pending}
      data-minimized={minimized}
      data-running={running}
      onClick={onClick}
      onMouseEnter={() => onLabel(name)}
      onMouseLeave={(event) => {
        if (event.currentTarget !== document.activeElement) onLabel(null)
      }}
      onFocus={() => onLabel(name)}
      onBlur={(event) => {
        if (!event.currentTarget.matches(':hover')) onLabel(null)
      }}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
      {running && <span className={styles.indicator} aria-hidden="true" />}
    </button>
  )
}
