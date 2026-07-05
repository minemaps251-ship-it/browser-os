import type { VfsSnapshot } from '../filesystem/types.js'
import type { ThemePreference } from '../settings/types.js'
/** Validated committed records from workspace-owned readers, never raw import input. */
export interface ExportSnapshot extends VfsSnapshot {
  readonly theme: ThemePreference
}
export type ExportErrorCode =
  'UNAVAILABLE' | 'INVALID_DATA' | 'TOO_LARGE' | 'DISPOSED'
export type ExportResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: {
        readonly code: ExportErrorCode
        readonly message: string
      }
    }
export type ExportReader = () => Promise<ExportResult<ExportSnapshot>>
interface EntryBase {
  readonly id: string
  readonly parentId: string | null
  readonly name: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly protected: boolean
}
export type ExportEntry = EntryBase &
  (
    | { readonly kind: 'directory' }
    | {
        readonly kind: 'file'
        readonly mime: string
        readonly encoding: 'utf-8'
        readonly text: string
      }
  )
export interface WorkspaceExport {
  readonly format: 'browser-os-workspace'
  readonly version: 1
  readonly exportedAt: string
  readonly source: 'persistent' | 'temporary'
  readonly settings: { readonly theme: ThemePreference }
  readonly entries: readonly ExportEntry[]
}
export interface ExportArtifact {
  readonly json: string
  readonly filename: string
  readonly byteLength: number
  readonly fileCount: number
  readonly folderCount: number
}
export function exportFailure(
  code: ExportErrorCode,
  message: string,
): Extract<ExportResult<never>, { ok: false }> {
  return { ok: false, error: { code, message } }
}
