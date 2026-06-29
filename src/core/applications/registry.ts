import type { AppId } from '../shared/ids'
import type { Size } from '../shared/geometry'

export interface ApplicationManifest {
  readonly id: AppId
  readonly name: string
  readonly description: string
  readonly icon: string
  readonly dock?: 'pinned'
  readonly fileAssociations?: readonly {
    readonly mime: string
    readonly default?: boolean
  }[]
  readonly instancePolicy: 'singleton' | 'multiple'
  readonly window: { readonly defaultSize: Size; readonly minSize: Size }
}

export function createRegistry(manifests: readonly ApplicationManifest[]) {
  const byId = new Map<AppId, ApplicationManifest>()
  const defaults = new Set<string>()
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
      !['singleton', 'multiple'].includes(manifest.instancePolicy) ||
      (manifest.dock !== undefined && manifest.dock !== 'pinned')
    ) {
      throw new Error(`Invalid or duplicate application: ${manifest.id}`)
    }
    const associations = manifest.fileAssociations ?? []
    const types = new Set<string>()
    for (const association of associations) {
      if (
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(association.mime) ||
        types.has(association.mime) ||
        (association.default !== undefined &&
          typeof association.default !== 'boolean') ||
        manifest.instancePolicy !== 'multiple' ||
        (association.default && defaults.has(association.mime))
      )
        throw new Error(`Invalid file association: ${manifest.id}`)
      types.add(association.mime)
      if (association.default) defaults.add(association.mime)
    }
    byId.set(
      manifest.id,
      Object.freeze({
        ...manifest,
        fileAssociations: Object.freeze(
          associations.map((association) => Object.freeze({ ...association })),
        ),
        window: Object.freeze({
          defaultSize: Object.freeze({ ...defaultSize }),
          minSize: Object.freeze({ ...minSize }),
        }),
      }),
    )
  }
  const entries = Object.freeze([...byId.values()])
  return {
    get: (id: AppId) => byId.get(id),
    list: () => entries,
    fileHandler: (mime: string) => {
      const handlers = entries.filter((entry) =>
        entry.fileAssociations?.some(
          (association) => association.mime === mime,
        ),
      )
      return (
        handlers.find((entry) =>
          entry.fileAssociations?.some(
            (association) => association.mime === mime && association.default,
          ),
        ) ?? (handlers.length === 1 ? handlers[0] : undefined)
      )
    },
  }
}
export type ApplicationRegistry = ReturnType<typeof createRegistry>
