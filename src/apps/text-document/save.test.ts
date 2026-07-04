import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
import { createTextDocumentSession } from './session'
async function fixture() {
  const workspace = temporaryWorkspace()
  const file = await workspace.vfs.createFile(ROOT_NODE_ID, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Original',
  })
  if (!file.ok) throw new Error('Missing file')
  const session = createTextDocumentSession(
    workspace.vfs,
    workspace.refresh,
    file.value,
  )
  session.start()
  await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
  return {
    workspace,
    session,
    fileId: file.value,
    dispose: () => {
      session.stop()
      workspace.dispose()
    },
  }
}
it('serializes saves, retains newer edits and advances baseline only after commit', async () => {
  const { workspace, session, fileId, dispose } = await fixture()
  const original = workspace.vfs.writeFile
  const gate = deferred<void>()
  const write = vi
    .spyOn(workspace.vfs, 'writeFile')
    .mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
  try {
    session.edit('First 🌍')
    const pending = session.save()
    expect(session.save()).toBe(pending)
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    expect(session.getSnapshot()).toMatchObject({
      saving: true,
      baseline: 'Original',
      dirty: true,
    })
    session.edit('Newer text')
    gate.resolve()
    expect(await pending).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      saving: false,
      dirty: true,
      buffer: 'Newer text',
      baseline: 'First 🌍',
      baselineRevision: 2,
    })
    expect(await workspace.vfs.readFile(fileId)).toMatchObject({
      ok: true,
      value: { content: { text: 'First 🌍' } },
    })
    expect(await session.save()).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      dirty: false,
      buffer: 'Newer text',
      baselineRevision: 3,
    })
    expect(write).toHaveBeenCalledTimes(2)
  } finally {
    dispose()
  }
})
it('keeps dirty text on external writes/Refresh and resolves conflict only by explicit discard', async () => {
  const { workspace, session, fileId, dispose } = await fixture()
  try {
    session.edit('Local')
    await workspace.vfs.rename(fileId, 'renamed.txt')
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        path: '/renamed.txt',
        buffer: 'Local',
        dirty: true,
        conflict: false,
      }),
    )
    await workspace.vfs.writeFile(
      fileId,
      { kind: 'text', encoding: 'utf-8', text: 'External' },
      { expectedContentRevision: 1, requestId: 'external' },
    )
    await workspace.refresh.request()
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        buffer: 'Local',
        baseline: 'Original',
        baselineRevision: 1,
        conflict: true,
      }),
    )
    expect(await session.save()).toBe(false)
    expect(await workspace.vfs.readFile(fileId)).toMatchObject({
      ok: true,
      value: { content: { text: 'External' } },
    })
    await session.discardAndReload()
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'External',
      baselineRevision: 2,
      dirty: false,
      conflict: false,
    })
  } finally {
    dispose()
  }
})
it('retains edits and error diagnostics on failed saves and handles an optimistic conflict at dispatch', async () => {
  const { workspace, session, fileId, dispose } = await fixture()
  const original = workspace.vfs.writeFile
  const write = vi.spyOn(workspace.vfs, 'writeFile')
  try {
    session.edit('Local')
    for (const code of ['QUOTA', 'TOO_LARGE', 'STORAGE_UNAVAILABLE'] as const) {
      write.mockResolvedValueOnce({
        ok: false,
        error: { code, message: 'failed' },
      })
      expect(await session.save()).toBe(false)
      expect(session.getSnapshot()).toMatchObject({
        dirty: true,
        buffer: 'Local',
        baselineRevision: 1,
        saving: false,
        notice: expect.any(String),
      })
    }
    write.mockImplementationOnce(async (...args) => {
      await original(
        fileId,
        { kind: 'text', encoding: 'utf-8', text: 'Other connection' },
        { expectedContentRevision: 1, requestId: 'race' },
      )
      return original(...args)
    })
    expect(await session.save()).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'Local',
      conflict: true,
      dirty: true,
    })
    await session.discardAndReload()
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'Other connection',
      dirty: false,
      conflict: false,
    })
    session.edit('Deleted draft')
    await workspace.vfs.remove(fileId, { recursive: false })
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        availability: 'deleted',
        buffer: 'Deleted draft',
      }),
    )
    expect(await session.save()).toBe(false)
  } finally {
    dispose()
  }
})
it('deduplicates close, supports cancel/discard and never closes after newer edits during save', async () => {
  const { workspace, session, dispose } = await fixture()
  const original = workspace.vfs.writeFile
  try {
    expect(await session.requestClose()).toBe(true)
    session.edit('Dirty')
    const cancel = session.requestClose()
    expect(session.requestClose()).toBe(cancel)
    session.cancelClose()
    expect(await cancel).toBe(false)
    expect(session.getSnapshot()).toMatchObject({ dirty: true, closing: false })
    const close = session.requestClose()
    const gate = deferred<void>()
    const write = vi
      .spyOn(workspace.vfs, 'writeFile')
      .mockImplementationOnce(async (...args) => {
        await gate.promise
        return original(...args)
      })
    const saveClose = session.saveAndClose()
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
    session.edit('Latest')
    session.discardClose() // Cannot bypass a pending commit.
    gate.resolve()
    await saveClose
    expect(session.getSnapshot()).toMatchObject({
      closing: true,
      dirty: true,
      buffer: 'Latest',
    })
    await session.saveAndClose()
    expect(await close).toBe(true)
    session.edit('Discard me')
    const discard = session.requestClose()
    session.discardClose()
    expect(await discard).toBe(true)
  } finally {
    dispose()
  }
})
it('keeps close dialog on save error and resolves cancelled close on stop; late save cannot resurrect it', async () => {
  const { workspace, session, dispose } = await fixture()
  const original = workspace.vfs.writeFile
  try {
    session.edit('Dirty')
    const close = session.requestClose()
    vi.spyOn(workspace.vfs, 'writeFile').mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUOTA', message: 'quota' },
    })
    await session.saveAndClose()
    expect(session.getSnapshot()).toMatchObject({
      closing: true,
      dirty: true,
      notice: expect.stringContaining('full'),
    })
    const gate = deferred<void>()
    vi.spyOn(workspace.vfs, 'writeFile').mockImplementationOnce(
      async (...args) => {
        await gate.promise
        return original(...args)
      },
    )
    const saveClose = session.saveAndClose()
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ saving: true }),
    )
    await Promise.resolve()
    session.stop()
    expect(await close).toBe(false)
    const stopped = session.getSnapshot()
    gate.resolve()
    await saveClose
    expect(session.getSnapshot()).toBe(stopped)
  } finally {
    dispose()
  }
})

it('does not discard edits entered while a reload is pending and keeps drafts on read failure', async () => {
  const { workspace, session, fileId, dispose } = await fixture()
  try {
    session.edit('First draft')
    const original = workspace.vfs.readFile
    const gate = deferred<void>()
    vi.spyOn(workspace.vfs, 'readFile').mockImplementationOnce(
      async (...args) => {
        await gate.promise
        return original(...args)
      },
    )
    const reload = session.discardAndReload()
    session.edit('Latest draft')
    gate.resolve()
    await reload
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'Latest draft',
      dirty: true,
    })
    vi.spyOn(workspace.vfs, 'readFile').mockResolvedValueOnce({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'denied' },
    })
    await session.retry()
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'Latest draft',
      dirty: true,
      availability: 'unavailable',
    })
    await session.retry()
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'Latest draft',
      dirty: true,
      availability: 'available',
    })
    await workspace.vfs.remove(fileId, { recursive: false })
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({ availability: 'deleted' }),
    )
    const close = session.requestClose()
    session.discardClose()
    expect(await close).toBe(true)
  } finally {
    dispose()
  }
})

it('shares an in-flight save even when an observer requests another save synchronously', async () => {
  const { workspace, session, dispose } = await fixture()
  try {
    session.edit('One write')
    const write = vi.spyOn(workspace.vfs, 'writeFile')
    let reentrant: Promise<boolean> | null = null
    const off = session.subscribe(() => {
      const state = session.getSnapshot()
      if (state.status === 'ready' && state.saving && !reentrant)
        reentrant = session.save()
    })
    const pending = session.save()
    expect(reentrant).toBe(pending)
    expect(await pending).toBe(true)
    expect(write).toHaveBeenCalledOnce()
    off()
  } finally {
    dispose()
  }
})

it('rechecks latest edits after the post-commit read before reporting a fully saved document', async () => {
  const { workspace, session, dispose } = await fixture()
  try {
    session.edit('Committed')
    const original = workspace.vfs.readFile
    const gate = deferred<void>()
    const read = vi
      .spyOn(workspace.vfs, 'readFile')
      .mockImplementationOnce(async (...args) => {
        await gate.promise
        return original(...args)
      })
    const save = session.save()
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    session.edit('New edits after commit')
    gate.resolve()
    expect(await save).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      buffer: 'New edits after commit',
      baseline: 'Committed',
      dirty: true,
    })
  } finally {
    dispose()
  }
})
