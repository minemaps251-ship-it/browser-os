import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
} from 'react'
import {
  constrainPosition,
  resizeBounds,
  type ResizeEdge,
  type Position,
} from '../../core/windows/geometry'
import type { Bounds } from '../../core/windows/service'
import type { Size } from '../../core/shared/geometry'
import type { WindowId } from '../../core/shared/ids'
import { useRuntime } from '../../app/runtimeContext'

type Operation = { kind: 'move' } | { kind: 'resize'; edge: ResizeEdge }
type Session = Operation & {
  start: Bounds
  minimum: Size
  draft: Bounds
  area: Size
  pointer?: { id: number; x: number; y: number; target: HTMLElement }
}

export function useWindowInteraction(
  id: WindowId,
  frame: RefObject<HTMLElement | null>,
) {
  const runtime = useRuntime()
  const session = useRef<Session | null>(null)
  const raf = useRef<number | null>(null)
  const [mode, setMode] = useState<'pointer' | 'keyboard' | null>(null)
  const [previewBounds, setPreviewBounds] = useState<Bounds | null>(null)
  const [kind, setKind] = useState<'move' | 'resize'>('move')

  function area(): Size {
    const rect = frame.current?.parentElement?.getBoundingClientRect()
    return {
      width: Math.max(1, rect?.width || window.innerWidth - 32),
      height: Math.max(1, rect?.height || window.innerHeight - 180),
    }
  }
  function paint(point: Bounds) {
    if (frame.current) {
      frame.current.style.setProperty('left', `${point.x}px`)
      frame.current.style.setProperty('top', `${point.y}px`)
      frame.current.style.setProperty('width', `${point.width}px`)
      frame.current.style.setProperty('height', `${point.height}px`)
    }
  }
  function finish(commit: boolean) {
    const current = session.current
    if (!current) return
    session.current = null
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current)
      raf.current = null
    }
    if (commit) {
      if (current.kind === 'resize')
        runtime.resizeWindow(id, current.draft, area())
      else runtime.moveWindow(id, current.draft, area())
    }
    const bounds = runtime.windows.getState().byId[id]?.bounds
    if (bounds) paint(bounds)
    if (current.pointer?.target.hasPointerCapture(current.pointer.id))
      current.pointer.target.releasePointerCapture(current.pointer.id)
    setMode(null)
    setPreviewBounds(null)
  }
  // Lifetime listeners cancel gestures when viewport/focus changes, and release capture on close.
  useEffect(() => {
    const element = frame.current
    const workspace = element?.parentElement
    function restore() {
      const current = session.current
      if (!current) return
      session.current = null
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
      if (element) {
        element.style.left = `${current.start.x}px`
        element.style.top = `${current.start.y}px`
        element.style.width = `${current.start.width}px`
        element.style.height = `${current.start.height}px`
      }
      if (current.pointer?.target.hasPointerCapture(current.pointer.id))
        current.pointer.target.releasePointerCapture(current.pointer.id)
      setMode(null)
      setPreviewBounds(null)
    }
    const unsubscribe = runtime.windows.subscribe((state) => {
      if (state.byId[id]?.status === 'minimized') restore()
    })
    function resize() {
      restore()
      const bounds = runtime.windows.getState().byId[id]?.bounds
      const rect = workspace?.getBoundingClientRect()
      if (bounds && rect && rect.width > 0 && rect.height > 0)
        runtime.resizeWindow(id, bounds, rect)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape' && session.current?.pointer) {
        event.preventDefault()
        restore()
      }
    }
    function blur() {
      if (session.current?.pointer) restore()
    }
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    if (workspace) observer?.observe(workspace)
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    return () => {
      unsubscribe()
      observer?.disconnect()
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', blur)
      const current = session.current
      session.current = null
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      if (current?.pointer?.target.hasPointerCapture(current.pointer.id))
        current.pointer.target.releasePointerCapture(current.pointer.id)
    }
  }, [id, runtime, frame])

  function start(
    kind: 'move' | 'resize',
    pointer?: Session['pointer'],
    edge?: ResizeEdge,
  ) {
    const bounds = runtime.windows.getState().byId[id]?.bounds
    if (
      runtime.windows.getState().byId[id]?.status !== 'visible' ||
      !bounds ||
      session.current ||
      window.innerWidth <= 600
    )
      return false
    runtime.focusWindow(id)
    const record = runtime.windows.getState().byId[id]!
    const minimum = runtime.registry.get(record.appId)!.window.minSize
    const operation: Operation =
      kind === 'resize' ? { kind, edge: edge ?? 'se' } : { kind }
    session.current = {
      ...operation,
      minimum,
      start: bounds,
      draft: bounds,
      area: area(),
      pointer,
    }
    setKind(kind)
    setMode(pointer ? 'pointer' : 'keyboard')
    setPreviewBounds(bounds)
    return true
  }
  function update(delta: Position, incremental = false) {
    const current = session.current
    if (!current) return
    const base = incremental ? current.draft : current.start
    current.draft =
      current.kind === 'resize'
        ? resizeBounds(base, current.edge, delta, current.minimum, current.area)
        : {
            ...base,
            ...constrainPosition(
              base,
              { x: base.x + delta.x, y: base.y + delta.y },
              current.area,
            ),
          }
    if (!current.pointer) {
      paint(current.draft)
      setPreviewBounds(current.draft)
      return
    }
    if (raf.current === null)
      raf.current = requestAnimationFrame(() => {
        raf.current = null
        if (session.current) paint(session.current.draft)
      })
  }
  function pointerDown(event: PointerEvent<HTMLElement>, edge?: ResizeEdge) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target instanceof Element &&
        !edge &&
        event.target.closest('button, a, input, select, textarea'))
    )
      return
    if (
      !start(
        edge ? 'resize' : 'move',
        {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          target: event.currentTarget,
        },
        edge,
      )
    )
      return
    event.preventDefault()
    frame.current?.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    const current = session.current
    if (!current?.pointer || current.pointer.id !== event.pointerId) return
    update({
      x: event.clientX - current.pointer.x,
      y: event.clientY - current.pointer.y,
    })
  }
  return {
    mode,
    kind,
    previewBounds,
    startKeyboard: (kind: 'move' | 'resize') => start(kind),
    adjustBy: (x: number, y: number) => {
      if (session.current) update({ x, y }, true)
    },
    finish: (commit: boolean) => finish(commit),
    pointerDown,
    pointerMove,
    pointerUp: (event: PointerEvent<HTMLElement>) => {
      const current = session.current
      if (current?.pointer?.id !== event.pointerId) return
      const actualArea = area()
      if (
        actualArea.width !== current.area.width ||
        actualArea.height !== current.area.height
      ) {
        finish(false)
        return
      }
      pointerMove(event)
      finish(true)
    },
    pointerCancel: (event: PointerEvent<HTMLElement>) => {
      if (session.current?.pointer?.id === event.pointerId) finish(false)
    },
  }
}
