import type { ApplicationManifest } from '../../core/applications/registry'
import type { AppId } from '../../core/shared/ids'
export const terminalManifest: ApplicationManifest = {
  id: 'terminal' as AppId,
  name: 'Terminal',
  description: 'Explore your workspace with commands.',
  icon: '>_',
  instancePolicy: 'multiple',
  dock: 'pinned',
  window: {
    defaultSize: { width: 660, height: 460 },
    minSize: { width: 280, height: 240 },
  },
}
