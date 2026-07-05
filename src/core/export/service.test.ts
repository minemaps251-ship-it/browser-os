import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID, VFS_LIMITS } from '../filesystem/policy'
import { deferred } from '../../test/fixtures'
import { buildWorkspaceExport, createWorkspaceExportService } from './service'
import type { ExportSnapshot, WorkspaceExport } from './types'
import type { FileNode, NodeId, ContentId } from '../filesystem/types'
const snapshot: ExportSnapshot = {
  theme: 'dark',
  nodes: [
    {
      id: ROOT_NODE_ID,
      parentId: null,
      name: '',
      kind: 'directory',
      createdAt: 1,
      updatedAt: 1,
      metadataRevision: 1,
      metadata: { protected: true },
    },
  ],
  contents: [],
}
it('exports committed memory files/settings, stable IDs/empty directories and exact Unicode/EOL without live draft state', async () => {
  const workspace = temporaryWorkspace()
  try {
    const dir = await workspace.vfs.createDirectory(ROOT_NODE_ID, 'empty')
    const file = await workspace.vfs.createFile(ROOT_NODE_ID, 'текст.ts', {
      kind: 'text',
      encoding: 'utf-8',
      text: '日本語\r\n<script>literal()</script>\rEND\n',
    })
    if (!dir.ok || !file.ok) throw new Error('Seed failed')
    await workspace.settings.setTheme('dark')
    const result = await workspace.prepareExport()
    if (!result.ok) throw new Error(result.error.message)
    const document = JSON.parse(result.value.json) as WorkspaceExport
    expect(document).toMatchObject({
      format: 'browser-os-workspace',
      version: 1,
      source: 'temporary',
      settings: { theme: 'dark' },
    })
    expect(
      document.entries.find((entry) => entry.id === file.value),
    ).toMatchObject({
      kind: 'file',
      name: 'текст.ts',
      text: '日本語\r\n<script>literal()</script>\rEND\n',
      encoding: 'utf-8',
      parentId: ROOT_NODE_ID,
    })
    expect(
      document.entries.find((entry) => entry.id === dir.value),
    ).toMatchObject({ name: 'empty', kind: 'directory' })
    expect(result.value.byteLength).toBe(
      new TextEncoder().encode(result.value.json).byteLength,
    )
    expect(result.value.filename).toMatch(/^browser-os-[\dTZ-]+\.json$/)
    expect(document.entries.map((entry) => entry.id)).toEqual(
      document.entries.map((entry) => entry.id).sort(),
    )
    expect(result.value.fileCount).toBe(1)
    expect(result.value.json).not.toContain('contentRevision')
    expect(result.value.json).not.toContain('contentId')
  } finally {
    workspace.dispose()
  }
})
it('captures memory files and theme in one turn before subsequent committed changes', async () => {
  const workspace = temporaryWorkspace()
  try {
    const result = workspace.prepareExport()
    await workspace.settings.setTheme('light')
    await workspace.vfs.createDirectory(ROOT_NODE_ID, 'later')
    const exported = await result
    if (!exported.ok) throw new Error(exported.error.message)
    const parsed = JSON.parse(exported.value.json) as WorkspaceExport
    expect(parsed.settings.theme).toBe('system')
    expect(parsed.entries.some((entry) => entry.name === 'later')).toBe(false)
  } finally {
    workspace.dispose()
  }
})
it('rejects oversized trees, inconsistent content references and invalid generation time', () => {
  expect(
    buildWorkspaceExport(
      {
        ...snapshot,
        nodes: Array.from(
          { length: VFS_LIMITS.maxNodes + 1 },
          () => snapshot.nodes[0],
        ),
      },
      'temporary',
      1,
    ),
  ).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
  expect(buildWorkspaceExport(snapshot, 'temporary', NaN)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_DATA' },
  })
  expect(buildWorkspaceExport(snapshot, 'temporary', 1e100)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_DATA' },
  })
  const file: FileNode = {
    id: 'file' as NodeId,
    name: 'broken.txt',
    kind: 'file',
    parentId: ROOT_NODE_ID,
    createdAt: 1,
    updatedAt: 1,
    metadataRevision: 1,
    metadata: { protected: false },
    mime: 'text/plain',
    byteLength: 1,
    contentRevision: 1,
    contentId: 'text' as ContentId,
  }
  expect(
    buildWorkspaceExport(
      { ...snapshot, nodes: [...snapshot.nodes, file] },
      'temporary',
      1,
    ),
  ).toMatchObject({ ok: false, error: { code: 'INVALID_DATA' } })
  expect(
    buildWorkspaceExport(
      {
        ...snapshot,
        nodes: [...snapshot.nodes, file],
        contents: [
          {
            id: file.contentId,
            content: { kind: 'text', encoding: 'utf-8', text: 'too long' },
          },
        ],
      },
      'temporary',
      1,
    ),
  ).toMatchObject({ ok: false, error: { code: 'INVALID_DATA' } })
  expect(
    buildWorkspaceExport(
      {
        ...snapshot,
        contents: [
          {
            id: file.contentId,
            content: { kind: 'text', encoding: 'utf-8', text: 'x' },
          },
        ],
      },
      'temporary',
      1,
    ),
  ).toMatchObject({ ok: false, error: { code: 'INVALID_DATA' } })
})
it('rejects data beyond file and total text budgets before serialization', () => {
  const text = 'x'.repeat(VFS_LIMITS.maxFileBytes)
  const file: FileNode = {
    id: 'file' as NodeId,
    name: 'large.txt',
    kind: 'file',
    parentId: ROOT_NODE_ID,
    createdAt: 1,
    updatedAt: 1,
    metadataRevision: 1,
    metadata: { protected: false },
    mime: 'text/plain',
    byteLength: text.length,
    contentRevision: 1,
    contentId: 'content' as ContentId,
  }
  const files = Array.from({ length: 11 }, (_, i) => ({
    ...file,
    id: `file-${i}` as NodeId,
    contentId: `content-${i}` as ContentId,
  }))
  expect(
    buildWorkspaceExport(
      {
        ...snapshot,
        nodes: [...snapshot.nodes, ...files],
        contents: files.map((file) => ({
          id: file.contentId,
          content: { kind: 'text', encoding: 'utf-8', text },
        })),
      },
      'temporary',
      1,
    ),
  ).toMatchObject({ ok: false, error: { code: 'TOO_LARGE' } })
  expect(
    buildWorkspaceExport(
      {
        ...snapshot,
        nodes: [...snapshot.nodes, { ...file, byteLength: text.length + 1 }],
        contents: [
          {
            id: file.contentId,
            content: { kind: 'text', encoding: 'utf-8', text: text + 'x' },
          },
        ],
      },
      'temporary',
      1,
    ),
  ).toMatchObject({ ok: false })
})
it('ignores late snapshots after disposal and reports reader failure without pretending a copy exists', async () => {
  const pending = deferred<{ ok: true; value: ExportSnapshot }>()
  const read = vi.fn(() => pending.promise)
  const service = createWorkspaceExportService(read, 'persistent', () => 1)
  const operation = service.prepare()
  service.dispose()
  pending.resolve({ ok: true, value: snapshot })
  expect(await operation).toMatchObject({
    ok: false,
    error: { code: 'DISPOSED' },
  })
  expect(await service.prepare()).toMatchObject({
    ok: false,
    error: { code: 'DISPOSED' },
  })
  expect(read).toHaveBeenCalledTimes(1)
  const failed = createWorkspaceExportService(async () => {
    throw new Error('closed')
  }, 'persistent')
  expect(await failed.prepare()).toMatchObject({
    ok: false,
    error: { code: 'UNAVAILABLE' },
  })
})
