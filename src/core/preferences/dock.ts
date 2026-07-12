import type { ApplicationManifest } from '../applications/registry'
import type { AppId } from '../shared/ids'
import type { ShellPreferences } from './service'

export function pinnedApps(
  apps: readonly ApplicationManifest[],
  preferences: ShellPreferences,
): readonly AppId[] {
  const registered = new Set(apps.map((app) => app.id))
  return preferences.pinned === null
    ? apps
        .filter(
          (app) => app.instancePolicy === 'singleton' || app.dock === 'pinned',
        )
        .map((app) => app.id)
    : preferences.pinned.filter((id) => registered.has(id))
}
export function reorderPinned(
  ids: readonly AppId[],
  source: AppId,
  target: AppId,
): readonly AppId[] {
  if (source === target || !ids.includes(source) || !ids.includes(target))
    return ids
  const result = ids.filter((id) => id !== source)
  result.splice(ids.indexOf(target), 0, source)
  return result
}
