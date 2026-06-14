import type { WindowId } from '../../core/shared/ids'

export function windowElementId(id: WindowId) {
  return `browseros-window-${id}`
}
export function focusWindowElement(id: WindowId) {
  const element = document.getElementById(windowElementId(id))
  if (element && !element.contains(document.activeElement)) element.focus()
}
