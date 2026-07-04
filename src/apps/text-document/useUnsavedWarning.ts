import { useEffect } from 'react'
export function useUnsavedWarning(needed: boolean) {
  useEffect(() => {
    if (!needed) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [needed])
}
