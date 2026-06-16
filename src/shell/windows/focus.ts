import type { WindowId } from '../../core/shared/ids'

const rememberedTargets = new WeakMap<HTMLElement, HTMLElement>()

export function rememberWindowFocus(frame: HTMLElement, target: HTMLElement) {
  if (target.closest('[data-window-content]'))
    rememberedTargets.set(frame, target)
}

export function windowElementId(id: WindowId) {
  return `browseros-window-${id}`
}
export function focusWindowElement(id: WindowId) {
  const element = document.getElementById(windowElementId(id))
  if (
    !element ||
    element.hidden ||
    element.inert ||
    element.contains(document.activeElement)
  )
    return
  const target = rememberedTargets.get(element)
  if (
    target?.isConnected &&
    !target.closest('[hidden], [inert]') &&
    !target.matches(':disabled')
  )
    target.focus()
  if (!element.contains(document.activeElement)) element.focus()
}
