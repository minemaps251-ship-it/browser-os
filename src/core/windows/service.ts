import { constrainPosition, fitBounds, type Position } from './geometry'
import { createStore } from 'zustand/vanilla'
import type { AppId, ProcessId, WindowId } from '../shared/ids'
import type { Size } from '../shared/geometry'

export type Bounds = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>
export interface WindowInstance {
  readonly id: WindowId
  readonly appId: AppId
  readonly processId: ProcessId
  readonly title: string
  readonly bounds: Bounds
}
export interface WindowSnapshot {
  readonly byId: Readonly<Partial<Record<WindowId, WindowInstance>>>
  readonly ids: readonly WindowId[]
  readonly order: readonly WindowId[]
  readonly focusedId: WindowId | null
}
export const emptyWindows = (): WindowSnapshot => ({
  byId: {},
  ids: [],
  order: [],
  focusedId: null,
})

export function initialBounds(size: Size, area: Size, count: number): Bounds {
  if (
    ![size.width, size.height, area.width, area.height].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  ) {
    throw new Error(
      'Window size and usable area must be positive finite values',
    )
  }
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  const offset = 24 + (count % 5) * 24
  return {
    x: Math.min(offset, area.width - width),
    y: Math.min(offset, area.height - height),
    width,
    height,
  }
}
export function openWindow(
  state: WindowSnapshot,
  window: WindowInstance,
): WindowSnapshot {
  if (state.byId[window.id]) throw new Error('Duplicate window ID')
  const { x, y, width, height } = window.bounds
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('Invalid window bounds')
  }
  return {
    byId: { ...state.byId, [window.id]: window },
    ids: [...state.ids, window.id],
    order: [...state.order, window.id],
    focusedId: window.id,
  }
}
export function focusWindow(
  state: WindowSnapshot,
  id: WindowId,
): WindowSnapshot {
  if (!state.byId[id] || state.focusedId === id) return state
  return {
    ...state,
    order: [...state.order.filter((current) => current !== id), id],
    focusedId: id,
  }
}
export function removeWindow(
  state: WindowSnapshot,
  id: WindowId,
): WindowSnapshot {
  if (!state.byId[id]) return state
  const byId = { ...state.byId }
  delete byId[id]
  const order = state.order.filter((current) => current !== id)
  return {
    byId,
    ids: state.ids.filter((current) => current !== id),
    order,
    focusedId:
      state.focusedId === id ? (order.at(-1) ?? null) : state.focusedId,
  }
}
export function moveWindow(
  state: WindowSnapshot,
  id: WindowId,
  position: Position,
  area: Size,
): WindowSnapshot {
  const window = state.byId[id]
  if (!window) return state
  const next = constrainPosition(window.bounds, position, area)
  if (next.x === window.bounds.x && next.y === window.bounds.y) return state
  return {
    ...state,
    byId: {
      ...state.byId,
      [id]: { ...window, bounds: { ...window.bounds, ...next } },
    },
  }
}
export function resizeWindow(
  state: WindowSnapshot,
  id: WindowId,
  proposed: Bounds,
  minimum: Size,
  area: Size,
): WindowSnapshot {
  const window = state.byId[id]
  if (!window) return state
  const bounds = fitBounds(proposed, minimum, area)
  if (
    bounds.x === window.bounds.x &&
    bounds.y === window.bounds.y &&
    bounds.width === window.bounds.width &&
    bounds.height === window.bounds.height
  )
    return state
  return { ...state, byId: { ...state.byId, [id]: { ...window, bounds } } }
}
export function createWindowService() {
  const store = createStore<WindowSnapshot>(() => emptyWindows())
  return {
    // UI only subscribes; mutation commands are used by the runtime.
    read: {
      getState: store.getState,
      getInitialState: store.getInitialState,
      subscribe: store.subscribe,
    },
    open: (window: WindowInstance) =>
      store.setState((state) => openWindow(state, window), true),
    focus: (id: WindowId) =>
      store.setState((state) => focusWindow(state, id), true),
    move: (id: WindowId, position: Position, area: Size) =>
      store.setState((state) => moveWindow(state, id, position, area), true),
    resize: (id: WindowId, bounds: Bounds, minimum: Size, area: Size) =>
      store.setState(
        (state) => resizeWindow(state, id, bounds, minimum, area),
        true,
      ),
    remove: (id: WindowId) =>
      store.setState((state) => removeWindow(state, id), true),
  }
}
export type WindowService = ReturnType<typeof createWindowService>
