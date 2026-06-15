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
