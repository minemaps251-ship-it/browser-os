import type { ApplicationManifest } from '../../core/applications/registry'
import type { AppId } from '../../core/shared/ids'
export const filesManifest: ApplicationManifest = {
  id: 'files' as AppId,
  name: 'Files',
  description: 'Browse your workspace.',
  icon: 'F',
  instancePolicy: 'multiple',
  dock: 'pinned',
  window: {
    defaultSize: { width: 640, height: 460 },
    minSize: { width: 280, height: 240 },
  },
}
