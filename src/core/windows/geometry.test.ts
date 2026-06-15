import { describe, expect, it } from 'vitest'
import { constrainPosition } from './geometry'
import {
  createWindowService,
  moveWindow,
  emptyWindows,
  openWindow,
  type WindowInstance,
} from './service'
import type { AppId, ProcessId, WindowId } from '../shared/ids'

const window: WindowInstance = {
  id: 'first' as WindowId,
  appId: 'about' as AppId,
  processId: 'p' as ProcessId,
  title: 'First',
  bounds: { x: 24, y: 24, width: 300, height: 200 },
}
const area = { width: 800, height: 600 }

describe('move geometry', () => {
  it('clamps every edge and preserves dimensions', () => {
    expect(constrainPosition(window.bounds, { x: -50, y: 900 }, area)).toEqual({
      x: 0,
      y: 400,
    })
    expect(constrainPosition(window.bounds, { x: 900, y: -50 }, area)).toEqual({
      x: 500,
      y: 0,
    })
    expect(constrainPosition(window.bounds, { x: 80, y: 60 }, area)).toEqual({
      x: 80,
      y: 60,
    })
  })
  it('keeps oversized windows anchored at the origin', () => {
    expect(
      constrainPosition(
        window.bounds,
        { x: 100, y: 100 },
        { width: 100, height: 80 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })
  it.each([NaN, Infinity, -Infinity])(
    'rejects non-finite coordinates %s',
    (value) => {
      expect(() =>
        constrainPosition(window.bounds, { x: value, y: 0 }, area),
      ).toThrow('finite')
    },
  )
  it('rejects empty usable area', () => {
    expect(() =>
      constrainPosition(
        window.bounds,
        { x: 0, y: 0 },
        { width: 0, height: 100 },
      ),
    ).toThrow('positive')
  })
  it('updates only the moved record and preserves structural selectors', () => {
    const second = { ...window, id: 'second' as WindowId }
    const state = openWindow(openWindow(emptyWindows(), window), second)
    const moved = moveWindow(state, window.id, { x: 80, y: 90 }, area)
    expect(moved.ids).toBe(state.ids)
    expect(moved.order).toBe(state.order)
    expect(moved.focusedId).toBe(state.focusedId)
    expect(moved.byId[second.id]).toBe(second)
    expect(moved.byId[window.id]?.bounds).toEqual({
      ...window.bounds,
      x: 80,
      y: 90,
    })
    expect(moveWindow(moved, window.id, { x: 80, y: 90 }, area)).toBe(moved)
    expect(moveWindow(moved, 'missing' as WindowId, { x: 0, y: 0 }, area)).toBe(
      moved,
    )
  })
  it('does not publish redundant writes and preserves membership on focus', () => {
    const service = createWindowService()
    service.open(window)
    const ids = service.read.getState().ids
    let writes = 0
    const unsubscribe = service.read.subscribe(() => writes++)
    service.move(window.id, window.bounds, area)
    expect(writes).toBe(0)
    service.move(window.id, { x: 30, y: 40 }, area)
    expect(writes).toBe(1)
    expect(service.read.getState().ids).toBe(ids)
    unsubscribe()
  })
})
