import type { ApplicationManifest } from '../../core/applications/registry'
import type { AppId } from '../../core/shared/ids'
export const editorManifest: ApplicationManifest = {
  id: 'code-editor' as AppId,
  name: 'Code Editor',
  description: 'Edit text and source files.',
  icon: '</>',
  instancePolicy: 'multiple',
  fileOpenPolicy: 'reuse-window',
  fileAssociations: [{ mime: 'text/plain' }],
  window: {
    defaultSize: { width: 720, height: 520 },
    minSize: { width: 280, height: 240 },
  },
}
