import type { Size } from '../shared/geometry'
import type { Bounds } from './service'

export type Position = Readonly<{ x: number; y: number }>

export function constrainPosition(
  bounds: Bounds,
  position: Position,
  area: Size,
): Position {
  if (
    ![
      bounds.width,
      bounds.height,
      position.x,
      position.y,
      area.width,
      area.height,
    ].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    area.width <= 0 ||
    area.height <= 0
  )
    throw new Error('Move geometry must be finite with positive dimensions')
  return {
    x: Math.max(
      0,
      Math.min(position.x, Math.max(0, area.width - bounds.width)),
    ),
    y: Math.max(
      0,
      Math.min(position.y, Math.max(0, area.height - bounds.height)),
    ),
  }
}

export const resizeEdges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
export type ResizeEdge = (typeof resizeEdges)[number]

/** The usable area wins if the app minimum cannot fit in the viewport. */
export function fitBounds(bounds: Bounds, minimum: Size, area: Size): Bounds {
  if (
    ![
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      minimum.width,
      minimum.height,
      area.width,
      area.height,
    ].every(Number.isFinite) ||
    [
      bounds.width,
      bounds.height,
      minimum.width,
      minimum.height,
      area.width,
      area.height,
    ].some((value) => value <= 0)
  )
    throw new Error('Resize geometry must be finite with positive dimensions')
  const width = Math.min(area.width, Math.max(minimum.width, bounds.width))
  const height = Math.min(area.height, Math.max(minimum.height, bounds.height))
  return {
    ...constrainPosition({ ...bounds, width, height }, bounds, area),
    width,
    height,
  }
}

export function resizeBounds(
  start: Bounds,
  edge: ResizeEdge,
  delta: Position,
  minimum: Size,
  area: Size,
): Bounds {
  if (!resizeEdges.includes(edge) || ![delta.x, delta.y].every(Number.isFinite))
    throw new Error('Invalid resize edge or delta')
  const bounds = fitBounds(start, minimum, area)
  const minWidth = Math.min(minimum.width, area.width)
  const minHeight = Math.min(minimum.height, area.height)
  let left = bounds.x
  let top = bounds.y
  let right = bounds.x + bounds.width
  let bottom = bounds.y + bounds.height
  if (edge.includes('w'))
    left = Math.max(0, Math.min(left + delta.x, right - minWidth))
  if (edge.includes('e'))
    right = Math.min(area.width, Math.max(right + delta.x, left + minWidth))
  if (edge.includes('n'))
    top = Math.max(0, Math.min(top + delta.y, bottom - minHeight))
  if (edge.includes('s'))
    bottom = Math.min(area.height, Math.max(bottom + delta.y, top + minHeight))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
