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
  readonly status: 'visible' | 'minimized'
  readonly bounds: Bounds
  readonly placement:
    | { readonly kind: 'normal' }
    | { readonly kind: 'maximized'; readonly restoreBounds: Bounds }
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
  if (window.status !== 'visible' || window.placement.kind !== 'normal')
    throw new Error('New windows must be visible')
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
  if (
    !state.byId[id] ||
    state.byId[id]?.status === 'minimized' ||
    state.focusedId === id
  )
    return state
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
      state.focusedId === id
        ? (order.findLast(
            (candidate) => byId[candidate]?.status === 'visible',
          ) ?? null)
        : state.focusedId,
  }
}
export function minimizeWindow(
  state: WindowSnapshot,
  id: WindowId,
): WindowSnapshot {
  const window = state.byId[id]
  if (!window || window.status === 'minimized') return state
  const byId: WindowSnapshot['byId'] = {
    ...state.byId,
    [id]: { ...window, status: 'minimized' as const },
  }
  return {
    ...state,
    byId,
    focusedId:
      state.focusedId === id
        ? (state.order.findLast(
            (candidate) => byId[candidate]?.status === 'visible',
          ) ?? null)
        : state.focusedId,
  }
}
export function restoreWindow(
  state: WindowSnapshot,
  id: WindowId,
): WindowSnapshot {
  const window = state.byId[id]
  if (!window) return state
  const visible =
    window.status === 'minimized'
      ? {
          ...state,
          byId: {
            ...state.byId,
            [id]: { ...window, status: 'visible' as const },
          },
        }
      : state
  return focusWindow(visible, id)
}
export function moveWindow(
  state: WindowSnapshot,
  id: WindowId,
  position: Position,
  area: Size,
): WindowSnapshot {
  const window = state.byId[id]
  if (!window || window.placement.kind === 'maximized') return state
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
  if (!window || window.placement.kind === 'maximized') return state
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
function equalBounds(a: Bounds, b: Bounds) {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}
function maximizedBounds(area: Size): Bounds {
  if (
    ![area.width, area.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('Usable area must have positive finite dimensions')
  return { x: 0, y: 0, width: area.width, height: area.height }
}
export function maximizeWindow(
  state: WindowSnapshot,
  id: WindowId,
  area: Size,
): WindowSnapshot {
  const window = state.byId[id]
  if (
    !window ||
    window.status === 'minimized' ||
    window.placement.kind === 'maximized'
  )
    return state
  const bounds = maximizedBounds(area)
  return focusWindow(
    {
      ...state,
      byId: {
        ...state.byId,
        [id]: {
          ...window,
          bounds,
          placement: {
            kind: 'maximized' as const,
            restoreBounds: window.bounds,
          },
        },
      },
    },
    id,
  )
}
export function restoreWindowBounds(
  state: WindowSnapshot,
  id: WindowId,
  minimum: Size,
  area: Size,
): WindowSnapshot {
  const window = state.byId[id]
  if (
    !window ||
    window.status === 'minimized' ||
    window.placement.kind !== 'maximized'
  )
    return state
  const bounds = fitBounds(window.placement.restoreBounds, minimum, area)
  return focusWindow(
    {
      ...state,
      byId: {
        ...state.byId,
        [id]: {
          ...window,
          bounds,
          placement: { kind: 'normal' as const },
        },
      },
    },
    id,
  )
}
export function fitWindowToArea(
  state: WindowSnapshot,
  id: WindowId,
  minimum: Size,
  area: Size,
): WindowSnapshot {
  const window = state.byId[id]
  if (!window) return state
  if (window.placement.kind === 'normal')
    return resizeWindow(state, id, window.bounds, minimum, area)
  const bounds = maximizedBounds(area)
  if (equalBounds(bounds, window.bounds)) return state
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
    minimize: (id: WindowId) =>
      store.setState((state) => minimizeWindow(state, id), true),
    restore: (id: WindowId) =>
      store.setState((state) => restoreWindow(state, id), true),
    move: (id: WindowId, position: Position, area: Size) =>
      store.setState((state) => moveWindow(state, id, position, area), true),
    resize: (id: WindowId, bounds: Bounds, minimum: Size, area: Size) =>
      store.setState(
        (state) => resizeWindow(state, id, bounds, minimum, area),
        true,
      ),
    maximize: (id: WindowId, area: Size) =>
      store.setState((state) => maximizeWindow(state, id, area), true),
    restoreBounds: (id: WindowId, minimum: Size, area: Size) =>
      store.setState(
        (state) => restoreWindowBounds(state, id, minimum, area),
        true,
      ),
    fitToArea: (id: WindowId, minimum: Size, area: Size) =>
      store.setState(
        (state) => fitWindowToArea(state, id, minimum, area),
        true,
      ),
    remove: (id: WindowId) =>
      store.setState((state) => removeWindow(state, id), true),
  }
}
export type WindowService = ReturnType<typeof createWindowService>
