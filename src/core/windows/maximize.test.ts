import { expect, it } from 'vitest'
import {
  emptyWindows,
  openWindow,
  maximizeWindow,
  restoreWindowBounds,
  fitWindowToArea,
  minimizeWindow,
  restoreWindow,
  moveWindow,
  resizeWindow,
  type WindowInstance,
} from './service'
import type { AppId, ProcessId, WindowId } from '../shared/ids'
const window: WindowInstance = {
  id: 'w' as WindowId,
  appId: 'a' as AppId,
  processId: 'p' as ProcessId,
  title: 'App',
  status: 'visible',
  placement: { kind: 'normal' },
  bounds: { x: 24, y: 30, width: 560, height: 440 },
}
const area = { width: 1000, height: 700 }
const minimum = { width: 280, height: 240 }
const opened = () => openWindow(emptyWindows(), window)
it('maximizes, retains identity, and restores exact bounds with idempotent commands', () => {
  const initial = opened()
  const max = maximizeWindow(initial, window.id, area)
  expect(max.byId[window.id]?.bounds).toEqual({ x: 0, y: 0, ...area })
  expect(max.byId[window.id]?.placement).toEqual({
    kind: 'maximized',
    restoreBounds: window.bounds,
  })
  expect(max.ids).toBe(initial.ids)
  expect(max.byId[window.id]?.processId).toBe(window.processId)
  expect(maximizeWindow(max, window.id, area)).toBe(max)
  const restored = restoreWindowBounds(max, window.id, minimum, area)
  expect(restored.byId[window.id]?.bounds).toEqual(window.bounds)
  expect(restored.byId[window.id]?.placement).toEqual({ kind: 'normal' })
  expect(restoreWindowBounds(restored, window.id, minimum, area)).toBe(restored)
})
it('syncs viewport while minimized without overwriting saved bounds', () => {
  const max = maximizeWindow(opened(), window.id, area)
  const hidden = minimizeWindow(max, window.id)
  const smaller = fitWindowToArea(hidden, window.id, minimum, {
    width: 300,
    height: 250,
  })
  expect(smaller.byId[window.id]?.status).toBe('minimized')
  expect(smaller.byId[window.id]?.placement).toBe(
    max.byId[window.id]?.placement,
  )
  const shown = restoreWindow(smaller, window.id)
  const normal = restoreWindowBounds(shown, window.id, minimum, {
    width: 300,
    height: 250,
  })
  expect(normal.byId[window.id]?.bounds).toEqual({
    x: 0,
    y: 0,
    width: 300,
    height: 250,
  })
})
it('viewport growth fills the area and repeated sync does not write', () => {
  const max = maximizeWindow(opened(), window.id, area)
  const larger = fitWindowToArea(max, window.id, minimum, {
    width: 1200,
    height: 900,
  })
  expect(larger.byId[window.id]?.bounds).toEqual({
    x: 0,
    y: 0,
    width: 1200,
    height: 900,
  })
  expect(
    fitWindowToArea(larger, window.id, minimum, { width: 1200, height: 900 }),
  ).toBe(larger)
  expect(
    restoreWindowBounds(larger, window.id, minimum, area).byId[window.id]
      ?.bounds,
  ).toEqual(window.bounds)
})
it('maximized windows reject move/resize and hidden placement commands are no-ops', () => {
  const max = maximizeWindow(opened(), window.id, area)
  expect(moveWindow(max, window.id, { x: 10, y: 10 }, area)).toBe(max)
  expect(resizeWindow(max, window.id, window.bounds, minimum, area)).toBe(max)
  const hidden = minimizeWindow(max, window.id)
  expect(restoreWindowBounds(hidden, window.id, minimum, area)).toBe(hidden)
  expect(
    maximizeWindow(minimizeWindow(opened(), window.id), window.id, area).byId[
      window.id
    ]?.placement.kind,
  ).toBe('normal')
})
it('tiny viewport wins over minimum, rejects invalid area, and unknown ids do nothing', () => {
  const state = opened()
  expect(maximizeWindow(state, 'unknown' as WindowId, area)).toBe(state)
  expect(() =>
    maximizeWindow(state, window.id, { width: NaN, height: 10 }),
  ).toThrow()
  const max = maximizeWindow(state, window.id, { width: 100, height: 80 })
  expect(
    restoreWindowBounds(max, window.id, minimum, { width: 100, height: 80 })
      .byId[window.id]?.bounds,
  ).toEqual({ x: 0, y: 0, width: 100, height: 80 })
})
