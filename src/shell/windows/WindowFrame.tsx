import { Dialog } from '../../ui/Dialog'
import { WindowMenu } from './WindowMenu'
import { useWindowInteraction } from './useWindowInteraction'
import { resizeEdges } from '../../core/windows/geometry'
import styles from './WindowFrame.module.css'
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
  const actions = useRef<HTMLButtonElement>(null)
  const interaction = useWindowInteraction(id, frame)
  useEffect(() => {
    if (
      focused &&
      frame.current &&
      !frame.current.contains(document.activeElement)
    ) {
      frame.current.focus()
    }
  }, [focused, frame])
  if (!window) return null
  const content = runtime.getContent(window.appId)
  const action = interaction.kind === 'resize' ? 'Resize' : 'Move'
  return (
    <section
      id={windowElementId(id)}
      ref={frame}
      tabIndex={-1}
      aria-label={`${window.title} window`}
      className={`${styles.frame}${focused ? ` ${styles.focused}` : ''}`}
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
      <header
        className={`${styles.titlebar}${interaction.mode === 'pointer' && interaction.kind === 'move' ? ` ${styles.dragging}` : ''}`}
        onPointerDown={(event) => interaction.pointerDown(event)}
        onPointerMove={interaction.pointerMove}
        onPointerUp={interaction.pointerUp}
        onPointerCancel={interaction.pointerCancel}
        onLostPointerCapture={interaction.pointerCancel}
      >
        <span className={styles.brand} aria-hidden="true">
          B
        </span>
        <h2>{window.title}</h2>
        <WindowMenu
          title={window.title}
          buttonRef={actions}
          onMove={() => interaction.startKeyboard('move')}
          onResize={() => interaction.startKeyboard('resize')}
        />
        <button
          className={styles.close}
          aria-label={`Close ${window.title}`}
          onClick={() => runtime.requestCloseWindow(id)}
        >
          ×
        </button>
      </header>
      {interaction.mode === 'keyboard' && (
        <Dialog
          label={`${action} ${window.title}`}
          returnFocus={actions}
          descriptionId={`${windowElementId(id)}-interaction-help`}
          onCancel={() => interaction.finish(false)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 40 : 10
            const delta: Record<string, [number, number]> = {
              ArrowLeft: [-step, 0],
              ArrowRight: [step, 0],
              ArrowUp: [0, -step],
              ArrowDown: [0, step],
            }
            if (delta[event.key]) {
              event.preventDefault()
              interaction.adjustBy(...delta[event.key])
            }
            if (event.key === 'Enter' && event.target === event.currentTarget) {
              event.preventDefault()
              interaction.finish(true)
            }
          }}
        >
          <h2>
            {action} {window.title}
          </h2>
          <p id={`${windowElementId(id)}-interaction-help`}>
            {interaction.kind === 'resize'
              ? 'Arrow keys resize the right and bottom edges; left/up shrink and right/down grow.'
              : 'Use arrow keys to move.'}{' '}
            Shift uses larger steps. Enter on Apply saves; Cancel or Escape
            restores the original bounds.
          </p>
          <p role="status">
            Position: {interaction.previewBounds?.x},{' '}
            {interaction.previewBounds?.y}. Size:{' '}
            {interaction.previewBounds?.width} ×{' '}
            {interaction.previewBounds?.height}.
          </p>
          <div aria-label={`${action} directions`}>
            <button onClick={() => interaction.adjustBy(-10, 0)}>
              {interaction.kind === 'resize' ? 'Narrower' : 'Left'}
            </button>
            <button onClick={() => interaction.adjustBy(0, -10)}>
              {interaction.kind === 'resize' ? 'Shorter' : 'Up'}
            </button>
            <button onClick={() => interaction.adjustBy(0, 10)}>
              {interaction.kind === 'resize' ? 'Taller' : 'Down'}
            </button>
            <button onClick={() => interaction.adjustBy(10, 0)}>
              {interaction.kind === 'resize' ? 'Wider' : 'Right'}
            </button>
          </div>
          <button
            data-dialog-initial-focus
            onClick={() => interaction.finish(true)}
          >
            Apply
          </button>
          <button onClick={() => interaction.finish(false)}>Cancel</button>
        </Dialog>
      )}
      {resizeEdges.map((edge) => (
        <div
          key={edge}
          aria-hidden="true"
          data-resize-edge={edge}
          className={styles.resizeHandle}
          onPointerDown={(event) => interaction.pointerDown(event, edge)}
          onPointerMove={interaction.pointerMove}
          onPointerUp={interaction.pointerUp}
          onPointerCancel={interaction.pointerCancel}
          onLostPointerCapture={interaction.pointerCancel}
        />
      ))}
      <div className={styles.content}>
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
