import { describe, expect, it } from 'vitest'
import { fitBounds, resizeBounds, type ResizeEdge } from './geometry'
import {
  emptyWindows,
  openWindow,
  resizeWindow,
  type WindowInstance,
} from './service'
import type { AppId, ProcessId, WindowId } from '../shared/ids'

const start = { x: 100, y: 80, width: 300, height: 240 }
const min = { width: 200, height: 150 }
const area = { width: 800, height: 600 }

describe('resize geometry', () => {
  it.each<[ResizeEdge, typeof start]>([
    ['n', { x: 100, y: 100, width: 300, height: 220 }],
    ['ne', { x: 100, y: 100, width: 330, height: 220 }],
    ['e', { x: 100, y: 80, width: 330, height: 240 }],
    ['se', { x: 100, y: 80, width: 330, height: 260 }],
    ['s', { x: 100, y: 80, width: 300, height: 260 }],
    ['sw', { x: 130, y: 80, width: 270, height: 260 }],
    ['w', { x: 130, y: 80, width: 270, height: 240 }],
    ['nw', { x: 130, y: 100, width: 270, height: 220 }],
  ])('%s changes only its selected edges', (edge, expected) => {
    expect(resizeBounds(start, edge, { x: 30, y: 20 }, min, area)).toEqual(
      expected,
    )
  })
  it('preserves opposite north/west anchors at minimum size', () => {
    expect(resizeBounds(start, 'nw', { x: 9999, y: 9999 }, min, area)).toEqual({
      x: 200,
      y: 170,
      width: 200,
      height: 150,
    })
    expect(
      resizeBounds(start, 'se', { x: -9999, y: -9999 }, min, area),
    ).toEqual({ ...start, width: 200, height: 150 })
  })
  it('clamps all edges to the workspace', () => {
    expect(
      resizeBounds(start, 'nw', { x: -9999, y: -9999 }, min, area),
    ).toEqual({ x: 0, y: 0, width: 400, height: 320 })
    expect(resizeBounds(start, 'se', { x: 9999, y: 9999 }, min, area)).toEqual({
      ...start,
      width: 700,
      height: 520,
    })
  })
  it('lets the viewport win when the minimum cannot fit, and recovers after growing', () => {
    const small = { width: 120, height: 90 }
    const fitted = resizeBounds(start, 'nw', { x: 100, y: 100 }, min, small)
    expect(fitted).toEqual({ x: 0, y: 0, width: 120, height: 90 })
    expect(fitBounds(fitted, min, area)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 150,
    })
  })
  it.each([NaN, Infinity, -Infinity])(
    'rejects non-finite input %s',
    (value) => {
      expect(() =>
        resizeBounds(start, 'se', { x: value, y: 0 }, min, area),
      ).toThrow('delta')
      expect(() => fitBounds({ ...start, width: value }, min, area)).toThrow(
        'finite',
      )
      expect(() =>
        fitBounds(start, { width: value, height: 150 }, area),
      ).toThrow('finite')
    },
  )
  it('rejects zero/negative dimensions and invalid handles', () => {
    expect(() => fitBounds(start, min, { width: 0, height: 100 })).toThrow(
      'positive',
    )
    expect(() => fitBounds({ ...start, height: -10 }, min, area)).toThrow(
      'positive',
    )
    expect(() =>
      resizeBounds(start, 'invalid' as ResizeEdge, { x: 0, y: 0 }, min, area),
    ).toThrow('edge')
  })
  it('retains unaffected records, membership and stacking, and ignores unknown/no-op commands', () => {
    const first: WindowInstance = {
      id: 'first' as WindowId,
      appId: 'app' as AppId,
      processId: 'p1' as ProcessId,
      title: 'First',
      status: 'visible',
      bounds: start,
    }
    const second = { ...first, id: 'second' as WindowId }
    const state = openWindow(openWindow(emptyWindows(), first), second)
    const resized = resizeWindow(
      state,
      first.id,
      { ...start, width: 400 },
      min,
      area,
    )
    expect(resized.ids).toBe(state.ids)
    expect(resized.order).toBe(state.order)
    expect(resized.focusedId).toBe(state.focusedId)
    expect(resized.byId[second.id]).toBe(second)
    expect(resized.byId[first.id]?.bounds.width).toBe(400)
    expect(
      resizeWindow(resized, first.id, { ...start, width: 400 }, min, area),
    ).toBe(resized)
    expect(resizeWindow(resized, 'missing' as WindowId, start, min, area)).toBe(
      resized,
    )
  })
})
