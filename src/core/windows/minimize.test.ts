import { describe, expect, it } from 'vitest'
import {
  emptyWindows,
  openWindow,
  minimizeWindow,
  restoreWindow,
  removeWindow,
  focusWindow,
  type WindowInstance,
} from './service'
import type { WindowId, AppId, ProcessId } from '../shared/ids'
const first: WindowInstance = {
  id: 'one' as WindowId,
  appId: 'app' as AppId,
  processId: 'p' as ProcessId,
  title: 'One',
  status: 'visible',
  bounds: { x: 24, y: 24, width: 300, height: 200 },
}
const second = { ...first, id: 'two' as WindowId }
const third = { ...first, id: 'three' as WindowId }
const opened = () =>
  openWindow(openWindow(openWindow(emptyWindows(), first), second), third)
describe('minimize/restore', () => {
  it('selects the highest visible survivor, skipping minimized windows', () => {
    const state = opened()
    const background = minimizeWindow(state, second.id)
    expect(background.focusedId).toBe(third.id)
    const hidden = minimizeWindow(background, third.id)
    expect(hidden.focusedId).toBe(first.id)
    expect(hidden.ids).toBe(state.ids)
    expect(hidden.order).toBe(state.order)
    expect(hidden.byId[first.id]).toBe(first)
    expect(hidden.byId[third.id]?.bounds).toBe(third.bounds)
    expect(minimizeWindow(hidden, first.id).focusedId).toBeNull()
  })
  it('restores and raises exactly one instance; repeated commands are no-ops', () => {
    const state = minimizeWindow(opened(), third.id)
    expect(minimizeWindow(state, third.id)).toBe(state)
    expect(focusWindow(state, third.id)).toBe(state)
    const restored = restoreWindow(state, third.id)
    expect(restored.byId[third.id]?.status).toBe('visible')
    expect(restored.focusedId).toBe(third.id)
    expect(restored.order.at(-1)).toBe(third.id)
    expect(restored.ids).toBe(state.ids)
    expect(restoreWindow(restored, third.id)).toBe(restored)
  })
  it('closing the last visible window leaves minimized instances and no focus', () => {
    const state = minimizeWindow(minimizeWindow(opened(), first.id), second.id)
    const closed = removeWindow(state, third.id)
    expect(closed.focusedId).toBeNull()
    expect(closed.ids).toEqual([first.id, second.id])
    expect(removeWindow(closed, first.id).focusedId).toBeNull()
    expect(restoreWindow(closed, second.id).focusedId).toBe(second.id)
  })
  it('rejects opening an already minimized record', () => {
    expect(() =>
      openWindow(emptyWindows(), { ...first, status: 'minimized' }),
    ).toThrow('visible')
  })
  it('ignores unknown IDs and closing a minimized window preserves active focus', () => {
    const state = minimizeWindow(opened(), second.id)
    expect(removeWindow(state, second.id).focusedId).toBe(third.id)
    expect(minimizeWindow(state, 'missing' as WindowId)).toBe(state)
    expect(restoreWindow(state, 'missing' as WindowId)).toBe(state)
  })
})
