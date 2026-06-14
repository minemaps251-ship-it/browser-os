import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { WindowId } from '../../core/shared/ids'
import { useRuntime } from '../../app/runtimeContext'
import { AppBoundary } from '../../app/AppBoundary'
import { windowElementId } from './focus'

export function WindowFrame({ id }: { id: WindowId }) {
  const runtime = useRuntime()
  const window = useStore(runtime.windows, (state) => state.byId[id])
  const focused = useStore(runtime.windows, (state) => state.focusedId === id)
  const zIndex = useStore(runtime.windows, (state) => state.order.indexOf(id))
  const frame = useRef<HTMLElement>(null)
  useEffect(() => {
    if (
      focused &&
      frame.current &&
      !frame.current.contains(document.activeElement)
    ) {
      frame.current.focus()
    }
  }, [focused])
  if (!window) return null
  const content = runtime.getContent(window.appId)
  return (
    <section
      id={windowElementId(id)}
      ref={frame}
      tabIndex={-1}
      aria-label={`${window.title} window`}
      className={`window-frame${focused ? ' is-focused' : ''}`}
      style={{
        left: window.bounds.x,
        top: window.bounds.y,
        width: window.bounds.width,
        height: window.bounds.height,
        zIndex,
      }}
      onPointerDown={() => runtime.focusWindow(id)}
      onFocus={() => runtime.focusWindow(id)}
    >
      <header className="window-titlebar">
        <span className="window-brand" aria-hidden="true">
          B
        </span>
        <h2>{window.title}</h2>
        <button
          className="window-close"
          aria-label={`Close ${window.title}`}
          onClick={() => runtime.requestCloseWindow(id)}
        >
          ×
        </button>
      </header>
      <div className="window-content">
        <AppBoundary onCrash={() => runtime.reportCrash(id)}>
          {content ? (
            content
          ) : (
            <p role="alert">Application renderer is unavailable.</p>
          )}
        </AppBoundary>
      </div>
    </section>
  )
}
