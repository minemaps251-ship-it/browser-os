import { loadEditorEngine } from './load'
import type { EngineModule, EnginePool } from './types'
/** Per-window lazy UI resources. Document sessions remain outside this owner. */
export function createEngineOwner(
  load: () => Promise<EngineModule> = loadEditorEngine,
) {
  let pool: EnginePool | null = null
  let pending: Promise<EnginePool> | null = null
  let disposed = false
  let ids: readonly string[] = []
  return {
    retain(next: readonly string[]) {
      ids = next
      pool?.retain(ids)
    },
    get(): Promise<EnginePool> {
      if (disposed) return Promise.reject(new Error('Editor window closed'))
      if (pool) return Promise.resolve(pool)
      if (pending) return pending
      const operation = load().then((module) => {
        if (disposed) throw new Error('Editor window closed')
        pool = module.createEnginePool()
        pool.retain(ids)
        return pool
      })
      pending = operation
      void operation.then(
        () => {
          if (pending === operation) pending = null
        },
        () => {
          if (pending === operation) pending = null
        },
      )
      return operation
    },
    dispose() {
      disposed = true
      ids = []
      pool?.dispose()
      pool = null
      pending = null
    },
  }
}
export type EngineOwner = ReturnType<typeof createEngineOwner>
