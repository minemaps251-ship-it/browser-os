import type { ApplicationManifest } from '../core/applications/registry'
import type { AppId, ProcessId, WindowId } from '../core/shared/ids'
import { createRegistry } from '../core/applications/registry'
import { createRuntime } from '../core/runtime/service'

export const firstApp: ApplicationManifest = {
  id: 'first' as AppId,
  name: 'First app',
  description: 'Test fixture',
  icon: '1',
  instancePolicy: 'multiple',
  window: {
    defaultSize: { width: 400, height: 300 },
    minSize: { width: 200, height: 150 },
  },
}
export const secondApp: ApplicationManifest = {
  ...firstApp,
  id: 'second' as AppId,
  name: 'Second app',
}
export function createTestRuntime(
  load: Parameters<typeof createRuntime>[0]['load'] = async () => {},
  manifests: readonly ApplicationManifest[] = [firstApp, secondApp],
) {
  let nextProcess = 0
  let nextWindow = 0
  return createRuntime({
    registry: createRegistry(manifests),
    load,
    ids: {
      process: () => `p-${++nextProcess}` as ProcessId,
      window: () => `w-${++nextWindow}` as WindowId,
    },
    now: () => 123,
    getUsableArea: () => ({ width: 1000, height: 700 }),
    onCleanupError: () => {},
  })
}
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
