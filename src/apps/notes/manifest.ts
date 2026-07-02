import type { ApplicationManifest } from '../../core/applications/registry'
import type { AppId } from '../../core/shared/ids'
export const notesManifest: ApplicationManifest = {
  id: 'notes' as AppId,
  name: 'Notes',
  description: 'Write and save text documents.',
  icon: 'N',
  instancePolicy: 'multiple',
  fileAssociations: [{ mime: 'text/plain', default: true }],
  window: {
    defaultSize: { width: 600, height: 460 },
    minSize: { width: 280, height: 240 },
  },
}
