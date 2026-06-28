import type { ComponentType } from 'react'
import type { ApplicationManifest } from '../core/applications/registry'
import { filesManifest } from '../apps/files/manifest'
import { aboutManifest } from '../apps/about/manifest'

export interface AppRegistration {
  readonly manifest: ApplicationManifest
  readonly load: () => Promise<{ default: ComponentType }>
}
export const builtInApps: readonly AppRegistration[] = [
  { manifest: aboutManifest, load: () => import('../apps/about/AboutApp') },
  { manifest: filesManifest, load: () => import('../apps/files/FilesApp') },
]
