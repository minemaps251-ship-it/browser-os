import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
import { createNotesSession } from './session'

it('creates a new document atomically, binds its ID and preserves newer edits during creation', async () => {
  const workspace = temporaryWorkspace()
  const bind = vi.fn()
  const session = createNotesSession(
    workspace.vfs,
    workspace.refresh,
    null,
    bind,
  )
  session.start()
  const gate = deferred<void>()
  const original = workspace.vfs.createFile
  const create = vi
    .spyOn(workspace.vfs, 'createFile')
    .mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
  try {
    session.edit('First 🌍')
    const save = session.saveAs(ROOT_NODE_ID, 'new.txt')
    expect(session.saveAs(ROOT_NODE_ID, 'ignored.txt')).toBe(save)
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce())
    session.edit('Latest')
    gate.resolve()
    const result = await save
    if (!result.ok) throw new Error('Create failed')
    expect(bind).toHaveBeenCalledWith(result.value)
    expect(session.getSnapshot()).toMatchObject({
      fileId: result.value,
      buffer: 'Latest',
      baseline: 'First 🌍',
      dirty: true,
      name: 'new.txt',
    })
    expect(await workspace.vfs.readFile(result.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'First 🌍' } },
    })
    expect(await session.save()).toBe(true)
    expect(await workspace.vfs.readFile(result.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Latest' } },
    })
  } finally {
    session.stop()
    workspace.dispose()
  }
})
it('save as preserves original text and recovers a deleted file without losing its buffer', async () => {
  const workspace = temporaryWorkspace()
  const source = await workspace.vfs.createFile(ROOT_NODE_ID, 'source.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Original',
  })
  if (!source.ok) throw new Error('Missing file')
  const bind = vi.fn()
  const session = createNotesSession(
    workspace.vfs,
    workspace.refresh,
    source.value,
    bind,
  )
  session.start()
  try {
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    session.edit('Copy text')
    const copy = await session.saveAs(ROOT_NODE_ID, 'copy.txt')
    if (!copy.ok) throw new Error('Copy failed')
    expect(await workspace.vfs.readFile(source.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Original' } },
    })
    expect(session.getSnapshot()).toMatchObject({
      fileId: copy.value,
      name: 'copy.txt',
      dirty: false,
    })
    session.edit('Recovered')
    await workspace.vfs.remove(copy.value, { recursive: false })
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        availability: 'deleted',
        buffer: 'Recovered',
      }),
    )
    const recovered = await session.saveAs(ROOT_NODE_ID, 'recovered.txt')
    if (!recovered.ok) throw new Error('Recovery failed')
    expect(await workspace.vfs.readFile(recovered.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Recovered' } },
    })
    expect(session.getSnapshot()).toMatchObject({
      availability: 'available',
      dirty: false,
      conflict: false,
    })
  } finally {
    session.stop()
    workspace.dispose()
  }
})
it('retains identity and draft on invalid/colliding/failed destinations and ignores late commit after stop', async () => {
  const workspace = temporaryWorkspace()
  const bind = vi.fn()
  const session = createNotesSession(
    workspace.vfs,
    workspace.refresh,
    null,
    bind,
  )
  session.start()
  try {
    session.edit('Keep text')
    await workspace.vfs.touchFile(ROOT_NODE_ID, 'taken.txt')
    expect(await session.saveAs(ROOT_NODE_ID, '')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_NAME' },
    })
    expect(await session.saveAs(ROOT_NODE_ID, 'taken.txt')).toMatchObject({
      ok: false,
      error: { code: 'ALREADY_EXISTS' },
    })
    const folder = await workspace.vfs.createDirectory(ROOT_NODE_ID, 'gone')
    if (!folder.ok) throw new Error('Missing folder')
    await workspace.vfs.remove(folder.value, { recursive: false })
    expect(await session.saveAs(folder.value, 'child')).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    const original = workspace.vfs.createFile
    const create = vi.spyOn(workspace.vfs, 'createFile')
    create.mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUOTA', message: 'quota' },
    })
    expect(await session.saveAs(ROOT_NODE_ID, 'quota.txt')).toMatchObject({
      ok: false,
    })
    expect(session.getSnapshot()).toMatchObject({
      fileId: null,
      buffer: 'Keep text',
      dirty: true,
      saving: false,
    })
    expect(bind).not.toHaveBeenCalled()
    const gate = deferred<void>()
    create.mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
    const pending = session.saveAs(ROOT_NODE_ID, 'late.txt')
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2))
    const close = session.requestClose()
    session.stop()
    expect(await close).toBe(false)
    const stopped = session.getSnapshot()
    gate.resolve()
    expect(await pending).toMatchObject({ ok: true })
    expect(bind).not.toHaveBeenCalled()
    expect(session.getSnapshot()).toBe(stopped)
    expect(
      await workspace.vfs.resolve('/late.txt', ROOT_NODE_ID),
    ).toMatchObject({ ok: true })
  } finally {
    session.stop()
    workspace.dispose()
  }
})

it('retains committed identity if the post-create read fails, and retries without creating another file', async () => {
  const workspace = temporaryWorkspace()
  const bind = vi.fn()
  const session = createNotesSession(
    workspace.vfs,
    workspace.refresh,
    null,
    bind,
  )
  session.start()
  try {
    session.edit('Committed text')
    vi.spyOn(workspace.vfs, 'readFile').mockResolvedValueOnce({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'unavailable' },
    })
    const saved = await session.saveAs(ROOT_NODE_ID, 'committed.txt')
    if (!saved.ok) throw new Error('Creation failed')
    expect(session.getSnapshot()).toMatchObject({
      fileId: saved.value,
      name: 'committed.txt',
      buffer: 'Committed text',
      dirty: false,
      availability: 'unavailable',
    })
    expect(bind).toHaveBeenCalledOnce()
    await session.retry()
    expect(session.getSnapshot()).toMatchObject({
      fileId: saved.value,
      availability: 'available',
    })
  } finally {
    session.stop()
    workspace.dispose()
  }
})
