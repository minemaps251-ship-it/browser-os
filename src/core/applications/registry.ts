import type { AppId } from '../shared/ids'
import type { Size } from '../shared/geometry'

export interface ApplicationManifest {
  readonly id: AppId
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly instancePolicy: 'singleton' | 'multiple'
  readonly window: { readonly defaultSize: Size; readonly minSize: Size }
}

export function createRegistry(manifests: readonly ApplicationManifest[]) {
  const byId = new Map<AppId, ApplicationManifest>()
  for (const manifest of manifests) {
    const { defaultSize, minSize } = manifest.window
    if (
      !manifest.id.trim() ||
      !manifest.name.trim() ||
      byId.has(manifest.id) ||
      ![
        defaultSize.width,
        defaultSize.height,
        minSize.width,
        minSize.height,
      ].every((value) => Number.isFinite(value) && value > 0) ||
      defaultSize.width < minSize.width ||
      defaultSize.height < minSize.height ||
      !['singleton', 'multiple'].includes(manifest.instancePolicy)
    ) {
      throw new Error(`Invalid or duplicate application: ${manifest.id}`)
    }
    byId.set(
      manifest.id,
      Object.freeze({
        ...manifest,
        window: Object.freeze({
          defaultSize: Object.freeze({ ...defaultSize }),
          minSize: Object.freeze({ ...minSize }),
        }),
      }),
    )
  }
  const entries = Object.freeze([...byId.values()])
  return { get: (id: AppId) => byId.get(id), list: () => entries }
}
export type ApplicationRegistry = ReturnType<typeof createRegistry>
