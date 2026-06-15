import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
} from 'react'
import { constrainPosition, type Position } from '../../core/windows/geometry'
import type { Bounds } from '../../core/windows/service'
import type { Size } from '../../core/shared/geometry'
import type { WindowId } from '../../core/shared/ids'
import { useRuntime } from '../../app/runtimeContext'

type Session = {
  start: Bounds
  draft: Position
  area: Size
  pointer?: { id: number; x: number; y: number; target: HTMLElement }
}

export function useWindowMove(
  id: WindowId,
  frame: RefObject<HTMLElement | null>,
) {
  const runtime = useRuntime()
  const session = useRef<Session | null>(null)
  const raf = useRef<number | null>(null)
  const [mode, setMode] = useState<'pointer' | 'keyboard' | null>(null)
  const [position, setPosition] = useState<Position | null>(null)

  function area(): Size {
    const rect = frame.current?.parentElement?.getBoundingClientRect()
    return {
      width: Math.max(1, rect?.width || window.innerWidth - 32),
      height: Math.max(1, rect?.height || window.innerHeight - 180),
    }
  }
  function paint(point: Position) {
    if (frame.current) {
      frame.current.style.setProperty('left', `${point.x}px`)
      frame.current.style.setProperty('top', `${point.y}px`)
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
    if (commit) runtime.moveWindow(id, current.draft, area())
    const bounds = runtime.windows.getState().byId[id]?.bounds
    if (bounds) paint(bounds)
    if (current.pointer?.target.hasPointerCapture(current.pointer.id))
      current.pointer.target.releasePointerCapture(current.pointer.id)
    setMode(null)
    setPosition(null)
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
      }
      if (current.pointer?.target.hasPointerCapture(current.pointer.id))
        current.pointer.target.releasePointerCapture(current.pointer.id)
      setMode(null)
      setPosition(null)
    }
    function resize() {
      restore()
      const bounds = runtime.windows.getState().byId[id]?.bounds
      const rect = workspace?.getBoundingClientRect()
      if (bounds && rect && rect.width > 0 && rect.height > 0)
        runtime.moveWindow(id, bounds, rect)
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

  function start(pointer?: Session['pointer']) {
    const bounds = runtime.windows.getState().byId[id]?.bounds
    if (!bounds || session.current || window.innerWidth <= 600) return false
    runtime.focusWindow(id)
    session.current = { start: bounds, draft: bounds, area: area(), pointer }
    setMode(pointer ? 'pointer' : 'keyboard')
    setPosition(bounds)
    return true
  }
  function update(point: Position) {
    const current = session.current
    if (!current) return
    current.draft = constrainPosition(current.start, point, current.area)
    if (!current.pointer) {
      paint(current.draft)
      setPosition(current.draft)
      return
    }
    if (raf.current === null)
      raf.current = requestAnimationFrame(() => {
        raf.current = null
        if (session.current) paint(session.current.draft)
      })
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target instanceof Element &&
        event.target.closest('button, a, input, select, textarea'))
    )
      return
    if (
      !start({
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        target: event.currentTarget,
      })
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
      x: current.start.x + event.clientX - current.pointer.x,
      y: current.start.y + event.clientY - current.pointer.y,
    })
  }
  return {
    mode,
    position,
    startKeyboard: () => start(),
    moveBy: (x: number, y: number) => {
      const point = session.current?.draft
      if (point) update({ x: point.x + x, y: point.y + y })
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
