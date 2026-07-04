import { useSyncExternalStore } from 'react'
function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}
function current() {
  return document.documentElement.dataset.theme === 'dark'
}
/** Observe the shell's resolved appearance; do not duplicate settings/media ownership. */
export function useEditorAppearance() {
  return useSyncExternalStore(subscribe, current)
}
