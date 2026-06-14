import { describe, expect, it } from 'vitest'
import {
  emptyWindows,
  focusWindow,
  initialBounds,
  openWindow,
  removeWindow,
  type WindowInstance,
} from './service'
import type { AppId, ProcessId, WindowId } from '../shared/ids'

const first: WindowInstance = {
  id: 'one' as WindowId,
  appId: 'app' as AppId,
  processId: 'p1' as ProcessId,
  title: 'First',
  bounds: { x: 0, y: 0, width: 300, height: 200 },
}
const second: WindowInstance = {
  ...first,
  id: 'two' as WindowId,
  processId: 'p2' as ProcessId,
}

describe('window lifecycle', () => {
  it('opens, raises focus, and preserves unaffected records', () => {
    const state = openWindow(openWindow(emptyWindows(), first), second)
    const focused = focusWindow(state, first.id)
    expect(focused.order).toEqual([second.id, first.id])
    expect(focused.focusedId).toBe(first.id)
    expect(focused.byId).toBe(state.byId)
    expect(focused.byId[second.id]).toBe(second)
    expect(focusWindow(focused, first.id)).toBe(focused)
  })
  it('closes the active window and chooses the last remaining window', () => {
    const state = openWindow(openWindow(emptyWindows(), first), second)
    const closed = removeWindow(state, second.id)
    expect(closed.focusedId).toBe(first.id)
    expect(closed.byId[second.id]).toBeUndefined()
    expect(removeWindow(closed, first.id)).toEqual(emptyWindows())
  })
  it('closing a background window preserves focus; unknown IDs are no-ops', () => {
    const state = openWindow(openWindow(emptyWindows(), first), second)
    expect(removeWindow(state, first.id).focusedId).toBe(second.id)
    expect(removeWindow(state, 'missing' as WindowId)).toBe(state)
    expect(focusWindow(state, 'missing' as WindowId)).toBe(state)
  })
  it('rejects duplicate IDs and invalid geometry', () => {
    expect(() => openWindow(openWindow(emptyWindows(), first), first)).toThrow(
      'Duplicate',
    )
    expect(() =>
      openWindow(emptyWindows(), {
        ...first,
        bounds: { ...first.bounds, x: -1 },
      }),
    ).toThrow('Invalid')
  })
  it('clamps oversized launch bounds to the usable viewport', () => {
    expect(
      initialBounds(
        { width: 500, height: 400 },
        { width: 240, height: 180 },
        3,
      ),
    ).toEqual({ x: 0, y: 0, width: 240, height: 180 })
  })
  it('cascades within the area and rejects invalid area', () => {
    const bounds = initialBounds(
      { width: 300, height: 200 },
      { width: 500, height: 400 },
      1,
    )
    expect(bounds).toEqual({ x: 48, y: 48, width: 300, height: 200 })
    expect(() =>
      initialBounds({ width: 300, height: 200 }, { width: 0, height: 400 }, 0),
    ).toThrow('positive')
  })
})
