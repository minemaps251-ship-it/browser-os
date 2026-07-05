import { VFS_LIMITS } from '../filesystem/policy'
import { prepareTextContent } from '../filesystem/content'
import { isThemePreference } from '../settings/types'
import {
  exportFailure,
  type ExportReader,
  type ExportSnapshot,
  type ExportResult,
  type ExportEntry,
  type ExportArtifact,
  type WorkspaceExport,
} from './types'
export const MAX_EXPORT_BYTES = 64 * 1024 * 1024
export function buildWorkspaceExport(
  snapshot: ExportSnapshot,
  source: 'persistent' | 'temporary',
  now: number,
): ExportResult<ExportArtifact> {
  if (!Number.isFinite(now) || !isThemePreference(snapshot.theme))
    return exportFailure('INVALID_DATA', 'The export metadata is invalid.')
  if (snapshot.nodes.length > VFS_LIMITS.maxNodes)
    return exportFailure(
      'TOO_LARGE',
      'The workspace exceeds the export limits.',
    )
  const contents = new Map(
    snapshot.contents.map((record) => [record.id, record.content]),
  )
  const entries: ExportEntry[] = []
  let fileCount = 0,
    bytes = 0
  for (const node of snapshot.nodes) {
    const base = {
      id: node.id,
      parentId: node.parentId,
      name: node.name,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      protected: node.metadata.protected,
    }
    if (node.kind === 'directory') entries.push({ ...base, kind: 'directory' })
    else {
      const content = contents.get(node.contentId)
      const prepared = content && prepareTextContent(content)
      if (
        !prepared ||
        !prepared.ok ||
        prepared.value.byteLength !== node.byteLength
      )
        return exportFailure(
          'INVALID_DATA',
          'A file could not be read consistently. Retry the export.',
        )
      if (prepared.value.byteLength > VFS_LIMITS.maxFileBytes)
        return exportFailure(
          'TOO_LARGE',
          'A file exceeds the 1 MiB export limit.',
        )
      bytes += prepared.value.byteLength
      if (bytes > VFS_LIMITS.maxTotalBytes)
        return exportFailure(
          'TOO_LARGE',
          'The workspace exceeds the export limits.',
        )
      entries.push({
        ...base,
        kind: 'file',
        mime: node.mime,
        encoding: 'utf-8',
        text: prepared.value.content.text,
      })
      fileCount++
    }
  }
  if (contents.size !== snapshot.contents.length || contents.size !== fileCount)
    return exportFailure(
      'INVALID_DATA',
      'File references are inconsistent. Export was not prepared.',
    )
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  try {
    const exportedAt = new Date(now).toISOString()
    const document: WorkspaceExport = {
      format: 'browser-os-workspace',
      version: 1,
      exportedAt,
      source,
      settings: { theme: snapshot.theme },
      entries,
    }
    const json = JSON.stringify(document, null, 2) + '\n'
    const byteLength = new TextEncoder().encode(json).byteLength
    if (byteLength > MAX_EXPORT_BYTES)
      return exportFailure(
        'TOO_LARGE',
        'The JSON copy exceeds the 64 MiB export limit.',
      )
    return {
      ok: true,
      value: {
        json,
        filename: `browser-os-${exportedAt.replace(/[:.]/g, '-')}.json`,
        byteLength,
        fileCount,
        folderCount: entries.length - fileCount,
      },
    }
  } catch {
    return exportFailure(
      'INVALID_DATA',
      'The workspace could not be serialized. Retry the export.',
    )
  }
}
export function createWorkspaceExportService(
  read: ExportReader,
  source: 'persistent' | 'temporary',
  now: () => number = Date.now,
) {
  let disposed = false
  return {
    async prepare(): Promise<ExportResult<ExportArtifact>> {
      if (disposed)
        return exportFailure('DISPOSED', 'This workspace has been closed.')
      try {
        const snapshot = await read()
        if (disposed)
          return exportFailure('DISPOSED', 'This workspace has been closed.')
        return snapshot.ok
          ? buildWorkspaceExport(snapshot.value, source, now())
          : snapshot
      } catch {
        return exportFailure(
          'UNAVAILABLE',
          'Workspace data could not be read. Retry the export.',
        )
      }
    },
    dispose() {
      disposed = true
    },
  }
}
