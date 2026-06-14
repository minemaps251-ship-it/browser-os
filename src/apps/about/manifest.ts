import type { ApplicationManifest } from '../../core/applications/registry'
import type { AppId } from '../../core/shared/ids'

export const aboutManifest: ApplicationManifest = {
  id: 'about' as AppId,
  name: 'About BrowserOS',
  icon: 'B',
  description: 'A small desktop. A foundation for bigger ideas.',
  instancePolicy: 'singleton',
  window: {
    defaultSize: { width: 560, height: 440 },
    minSize: { width: 280, height: 240 },
  },
}
