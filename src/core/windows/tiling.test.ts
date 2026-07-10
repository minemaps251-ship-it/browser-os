import { describe, expect, it } from 'vitest'
import { snapTarget, tileBounds, type SnapTarget } from './tiling'
import {
  emptyWindows,
  openWindow,
  snapWindow,
  restoreWindowBounds,
  fitWindowToArea,
  maximizeWindow,
  minimizeWindow,
  restoreWindow,
  resizeWindow,
  type WindowInstance,
} from './service'
import type { AppId, ProcessId, WindowId } from '../shared/ids'
const area = { width: 1200, height: 800 }
const minimum = { width: 280, height: 240 }
const window: WindowInstance = {
  id: 'w' as WindowId,
  appId: 'a' as AppId,
  processId: 'p' as ProcessId,
  title: 'Test',
  status: 'visible',
  placement: { kind: 'normal' },
  bounds: { x: 50, y: 40, width: 560, height: 440 },
}
describe('desktop tiling', () => {
  it.each<[number, number, SnapTarget]>([
    [0, 400, 'left'],
    [1200, 400, 'right'],
    [0, 0, 'top-left'],
    [1200, 0, 'top-right'],
    [0, 800, 'bottom-left'],
    [1200, 800, 'bottom-right'],
    [600, 0, 'maximize'],
  ])('detects %s,%s as %s', (x, y, target) => {
    expect(snapTarget({ x, y }, area, minimum)).toBe(target)
  })
  it('does not tile in the interior or below app minimums', () => {
    expect(snapTarget({ x: 400, y: 300 }, area, minimum)).toBeNull()
    expect(
      snapTarget({ x: 0, y: 0 }, { width: 500, height: 400 }, minimum),
    ).toBeNull()
    expect(() => tileBounds('left', { width: NaN, height: 800 })).toThrow()
  })
  it('partitions odd dimensions without gaps', () => {
    const odd = { width: 1001, height: 701 }
    expect(tileBounds('top-left', odd)).toEqual({
      x: 0,
      y: 0,
      width: 500,
      height: 350,
    })
    expect(tileBounds('bottom-right', odd)).toEqual({
      x: 500,
      y: 350,
      width: 501,
      height: 351,
    })
  })
  it('rejects unavailable tiles and unknown or minimized windows', () => {
    const state = openWindow(emptyWindows(), window)
    expect(
      snapWindow(state, window.id, 'left', minimum, {
        width: 500,
        height: 400,
      }),
    ).toBe(state)
    expect(
      snapWindow(state, 'missing' as WindowId, 'left', minimum, area),
    ).toBe(state)
    const hidden = minimizeWindow(state, window.id)
    expect(snapWindow(hidden, window.id, 'left', minimum, area)).toBe(hidden)
  })
  it('preserves placement through minimize and detaches when resized', () => {
    let state = snapWindow(
      openWindow(emptyWindows(), window),
      window.id,
      'left',
      minimum,
      area,
    )
    const placement = state.byId[window.id]!.placement
    state = restoreWindow(minimizeWindow(state, window.id), window.id)
    expect(state.byId[window.id]!.placement).toBe(placement)
    state = resizeWindow(
      state,
      window.id,
      { x: 0, y: 0, width: 500, height: 600 },
      minimum,
      area,
    )
    expect(state.byId[window.id]!.placement).toEqual({ kind: 'normal' })
  })
  it('restores a usable normal window if the viewport no longer fits a tile', () => {
    let state = snapWindow(
      openWindow(emptyWindows(), window),
      window.id,
      'top-left',
      minimum,
      area,
    )
    state = minimizeWindow(state, window.id)
    state = fitWindowToArea(state, window.id, minimum, {
      width: 500,
      height: 400,
    })
    expect(state.byId[window.id]).toMatchObject({
      status: 'minimized',
      placement: { kind: 'normal' },
      bounds: { x: 0, y: 0, width: 500, height: 400 },
    })
  })
  it('preserves original bounds across retile, maximize and viewport changes', () => {
    let state = openWindow(emptyWindows(), window)
    state = snapWindow(state, window.id, 'left', minimum, area)
    state = snapWindow(state, window.id, 'bottom-right', minimum, area)
    expect(state.byId[window.id]?.bounds).toEqual({
      x: 600,
      y: 400,
      width: 600,
      height: 400,
    })
    state = fitWindowToArea(state, window.id, minimum, {
      width: 1000,
      height: 600,
    })
    expect(state.byId[window.id]?.bounds).toEqual({
      x: 500,
      y: 300,
      width: 500,
      height: 300,
    })
    state = maximizeWindow(state, window.id, area)
    state = restoreWindowBounds(state, window.id, minimum, area)
    expect(state.byId[window.id]?.bounds).toEqual(window.bounds)
    expect(state.byId[window.id]?.placement).toEqual({ kind: 'normal' })
  })
})
