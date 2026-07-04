import type { ProcessId } from '../core/shared/ids'
import type { ApplicationLaunchInput } from '../core/applications/launchInput'
import type { ComponentType } from 'react'
import type { ApplicationManifest } from '../core/applications/registry'
import { editorManifest } from '../apps/editor/manifest'
import { settingsManifest } from '../apps/settings/manifest'
import { notesManifest } from '../apps/notes/manifest'
import { terminalManifest } from '../apps/terminal/manifest'
import { filesManifest } from '../apps/files/manifest'
import { aboutManifest } from '../apps/about/manifest'

export interface ApplicationProps {
  readonly processId: ProcessId
  readonly launchInput: ApplicationLaunchInput
}
export interface AppRegistration {
  readonly manifest: ApplicationManifest
  readonly load: () => Promise<{ default: ComponentType<ApplicationProps> }>
}
export const builtInApps: readonly AppRegistration[] = [
  { manifest: aboutManifest, load: () => import('../apps/about/AboutApp') },
  { manifest: filesManifest, load: () => import('../apps/files/FilesApp') },
  {
    manifest: terminalManifest,
    load: () => import('../apps/terminal/TerminalApp'),
  },
  {
    manifest: editorManifest,
    load: () => import('../apps/editor/CodeEditorApp'),
  },
  { manifest: notesManifest, load: () => import('../apps/notes/NotesApp') },
  {
    manifest: settingsManifest,
    load: () => import('../apps/settings/SettingsApp'),
  },
]
