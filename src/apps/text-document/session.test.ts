import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
import type { DocumentRead, VfsResult } from '../../core/filesystem/types'
import { createTextDocumentSession } from './session'

async function fixture() {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const file = await workspace.vfs.createFile(home.value, 'read me.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Hello 🌍\n<script>literal</script>',
  })
  if (!file.ok) throw new Error('Missing file')
  return { workspace, fileId: file.value, home: home.value }
}
it('reads coherent text, follows rename/move/content changes and reports deletion', async () => {
  const { workspace, fileId, home } = await fixture()
  const session = createTextDocumentSession(
    workspace.vfs,
    workspace.refresh,
    fileId,
  )
  session.start()
  try {
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        path: '/home/user/read me.txt',
        document: { content: { text: 'Hello 🌍\n<script>literal</script>' } },
      }),
    )
    const read = vi.spyOn(workspace.vfs, 'readFile')
    await workspace.vfs.touchFile(home, 'unrelated')
    expect(read).not.toHaveBeenCalled()
    await workspace.vfs.rename(fileId, 'new.txt')
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        path: '/home/user/new.txt',
        document: { node: { name: 'new.txt' } },
      }),
    )
    const directory = await workspace.vfs.createDirectory(home, 'folder')
    if (!directory.ok) throw new Error('Missing folder')
    await workspace.vfs.move(fileId, directory.value)
    await workspace.vfs.rename(directory.value, 'renamed')
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        path: '/home/user/renamed/new.txt',
      }),
    )
    await workspace.vfs.writeFile(
      fileId,
      { kind: 'text', encoding: 'utf-8', text: 'New text' },
      { expectedContentRevision: 1, requestId: 'notes-test' },
    )
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        document: { content: { text: 'New text' }, contentRevision: 2 },
      }),
    )
    read.mockClear()
    await workspace.refresh.request()
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    await workspace.vfs.remove(directory.value, { recursive: true })
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        availability: 'deleted',
        notice: expect.stringContaining('removed'),
      }),
    )
    expect(session.getSnapshot()).toHaveProperty('buffer', 'New text')
  } finally {
    session.stop()
    workspace.dispose()
  }
})
it('supports untitled, error/retry and restart without leaking subscriptions', async () => {
  const { workspace, fileId, home } = await fixture()
  const idle = createTextDocumentSession(workspace.vfs, workspace.refresh, null)
  const read = vi.spyOn(workspace.vfs, 'readFile')
  idle.start()
  await idle.retry()
  idle.stop()
  expect(read).not.toHaveBeenCalled()
  expect(idle.getSnapshot()).toMatchObject({
    status: 'ready',
    fileId: null,
    buffer: '',
    dirty: false,
  })
  read.mockResolvedValueOnce({
    ok: false,
    error: { code: 'STORAGE_UNAVAILABLE', message: 'unavailable' },
  })
  const session = createTextDocumentSession(
    workspace.vfs,
    workspace.refresh,
    fileId,
  )
  const folder = createTextDocumentSession(
    workspace.vfs,
    workspace.refresh,
    home,
  )
  session.start()
  folder.start()
  try {
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('error'))
    await vi.waitFor(() =>
      expect(folder.getSnapshot()).toMatchObject({
        status: 'error',
        message: expect.stringContaining('not a text file'),
      }),
    )
    folder.stop()
    await session.retry()
    expect(session.getSnapshot().status).toBe('ready')
    session.stop()
    session.start()
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    read.mockClear()
    await workspace.vfs.rename(fileId, 'restart.txt')
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    expect(read).toHaveBeenCalledOnce()
    session.stop()
    read.mockClear()
    await workspace.vfs.rename(fileId, 'closed.txt')
    expect(read).not.toHaveBeenCalled()
  } finally {
    session.stop()
    folder.stop()
    workspace.dispose()
  }
})
it('ignores stale and stopped reads including restart, and catches unexpected storage errors', async () => {
  const { workspace, fileId } = await fixture()
  const original = workspace.vfs.readFile
  const old = await original(fileId)
  const gate = deferred<VfsResult<DocumentRead>>()
  const read = vi
    .spyOn(workspace.vfs, 'readFile')
    .mockImplementationOnce(() => gate.promise)
  const session = createTextDocumentSession(
    workspace.vfs,
    workspace.refresh,
    fileId,
  )
  session.start()
  try {
    await workspace.vfs.writeFile(
      fileId,
      { kind: 'text', encoding: 'utf-8', text: 'Latest' },
      { expectedContentRevision: 1, requestId: 'latest' },
    )
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        document: { content: { text: 'Latest' } },
      }),
    )
    const current = session.getSnapshot()
    gate.resolve(old)
    await Promise.resolve()
    expect(session.getSnapshot()).toBe(current)
    read.mockRejectedValueOnce(new Error('unexpected'))
    await session.retry()
    expect(session.getSnapshot()).toMatchObject({
      status: 'ready',
      availability: 'unavailable',
      buffer: 'Latest',
    })
    const late = deferred<VfsResult<DocumentRead>>()
    read.mockImplementationOnce(() => late.promise)
    const pending = session.retry()
    session.stop()
    session.start()
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    await vi.waitFor(() =>
      expect(session.getSnapshot()).toMatchObject({
        status: 'ready',
        availability: 'available',
      }),
    )
    const restarted = session.getSnapshot()
    late.resolve(old)
    await pending
    expect(session.getSnapshot()).toBe(restarted)
  } finally {
    session.stop()
    workspace.dispose()
  }
})
