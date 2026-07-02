import type { ApplicationManifest } from '../../core/applications/registry'
import type { AppId } from '../../core/shared/ids'
export const settingsManifest: ApplicationManifest = {
  id: 'settings' as AppId,
  name: 'Settings',
  description: 'Choose appearance and view storage status.',
  icon: 'S',
  instancePolicy: 'singleton',
  window: {
    defaultSize: { width: 500, height: 440 },
    minSize: { width: 280, height: 240 },
  },
}
