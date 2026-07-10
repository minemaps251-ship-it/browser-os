import type { Size } from '../shared/geometry'
import type { Bounds } from './service'
import type { Position } from './geometry'

export type Tile =
  'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type SnapTarget = Tile | 'maximize'

export function tileBounds(tile: SnapTarget, area: Size): Bounds {
  if (
    ![area.width, area.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('Usable area must have positive finite dimensions')
  if (tile === 'maximize') return { x: 0, y: 0, ...area }
  const width = Math.floor(area.width / 2)
  const height = tile.includes('-') ? Math.floor(area.height / 2) : area.height
  const x = tile.endsWith('right') ? width : 0
  const y = tile.startsWith('bottom') ? height : 0
  return {
    x,
    y,
    width: x ? area.width - x : width,
    height: y ? area.height - y : height,
  }
}

/** Corners win over edges; never offer a tile smaller than the app minimum. */
export function snapTarget(
  point: Position,
  area: Size,
  minimum: Size,
): SnapTarget | null {
  const edge = 16
  const corner = Math.min(80, area.height / 4)
  const left = point.x <= edge
  const right = point.x >= area.width - edge
  let target: SnapTarget | null = null
  if (left || right) {
    const side = left ? 'left' : 'right'
    target =
      point.y <= corner
        ? `top-${side}`
        : point.y >= area.height - corner
          ? `bottom-${side}`
          : side
  } else if (point.y <= edge) target = 'maximize'
  if (!target) return null
  const bounds = tileBounds(target, area)
  return bounds.width >= Math.min(minimum.width, area.width) &&
    bounds.height >= Math.min(minimum.height, area.height)
    ? target
    : null
}
