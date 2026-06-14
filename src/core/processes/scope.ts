export function createProcessScope(onCleanupError: (error: unknown) => void) {
  const controller = new AbortController()
  const cleanups = new Set<() => void>()
  let disposed = false
  function run(cleanup: () => void) {
    try {
      cleanup()
    } catch (error) {
      try {
        onCleanupError(error)
      } catch {
        /* Diagnostics must not interrupt resource disposal. */
      }
    }
  }
  return {
    signal: controller.signal,
    registerCleanup(cleanup: () => void) {
      if (disposed) run(cleanup)
      else cleanups.add(cleanup)
      return () => {
        cleanups.delete(cleanup)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      const pending = [...cleanups]
      cleanups.clear()
      pending.forEach(run)
    },
  }
}
export type ProcessScope = ReturnType<typeof createProcessScope>
