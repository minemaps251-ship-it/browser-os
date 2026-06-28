import { describe, expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { createDirectorySession } from './session'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import type { FileSystemNode, VfsResult } from '../../core/filesystem/types'
import { deferred } from '../../test/fixtures'
async function fixture() {
  const workspace = temporaryWorkspace()
  const session = createDirectorySession(workspace.vfs, workspace.refresh)
  session.start()
  await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
  const home = session.getSnapshot().directoryId!
  const documents = session
    .getSnapshot()
    .entries.find((node) => node.name === 'Documents')!.id
  const desktop = session
    .getSnapshot()
    .entries.find((node) => node.name === 'Desktop')!.id
  return {
    workspace,
    session,
    home,
    documents,
    desktop,
    stop: () => {
      session.stop()
      workspace.dispose()
    },
  }
}
describe('Files directory session', () => {
  it('opens home and navigates by stable IDs with independent sessions', async () => {
    const f = await fixture()
    const second = createDirectorySession(f.workspace.vfs, f.workspace.refresh)
    second.start()
    await vi.waitFor(() => expect(second.getSnapshot().status).toBe('ready'))
    await f.session.navigate(f.documents)
    expect(f.session.getSnapshot()).toMatchObject({
      directoryId: f.documents,
      entries: [],
    })
    expect(
      f.session.getSnapshot().breadcrumbs.map((crumb) => crumb.name),
    ).toEqual(['Workspace', 'home', 'user', 'Documents'])
    expect(second.getSnapshot().directoryId).toBe(f.home)
    second.stop()
    f.stop()
  })
  it('ignores a slow reply when a newer navigation has completed', async () => {
    const f = await fixture()
    const pending = deferred<VfsResult<readonly FileSystemNode[]>>()
    vi.spyOn(f.workspace.vfs, 'listDirectory').mockImplementationOnce(
      () => pending.promise,
    )
    const first = f.session.navigate(f.documents)
    await f.session.navigate(f.desktop)
    pending.resolve({ ok: true, value: [] })
    await first
    expect(f.session.getSnapshot().directoryId).toBe(f.desktop)
    f.stop()
  })
  it('re-reads changes in the current folder and responds to workspace refresh', async () => {
    const f = await fixture()
    await f.workspace.vfs.createDirectory(f.home, 'Projects')
    await vi.waitFor(() =>
      expect(
        f.session
          .getSnapshot()
          .entries.some((node) => node.name === 'Projects'),
      ).toBe(true),
    )
    await f.session.navigate(f.documents)
    await f.workspace.refresh.request()
    await vi.waitFor(() => expect(f.session.getSnapshot().status).toBe('ready'))
    expect(f.session.getSnapshot().directoryId).toBe(f.documents)
    f.stop()
  })
  it('falls back to home when the current folder is deleted', async () => {
    const f = await fixture()
    await f.session.navigate(f.documents)
    await f.workspace.vfs.remove(f.documents, { recursive: false })
    await vi.waitFor(() =>
      expect(f.session.getSnapshot()).toMatchObject({
        status: 'ready',
        directoryId: f.home,
        notice: expect.stringContaining('removed'),
      }),
    )
    f.stop()
  })
  it('updates breadcrumbs after a rename without changing cwd', async () => {
    const f = await fixture()
    await f.session.navigate(f.documents)
    await f.workspace.vfs.rename(f.documents, 'Work')
    await vi.waitFor(() =>
      expect(f.session.getSnapshot().breadcrumbs.at(-1)?.name).toBe('Work'),
    )
    expect(f.session.getSnapshot().directoryId).toBe(f.documents)
    f.stop()
  })
  it('shows read errors and permits retry', async () => {
    const f = await fixture()
    vi.spyOn(f.workspace.vfs, 'listDirectory').mockResolvedValueOnce({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'Denied' },
    })
    await f.session.reload()
    expect(f.session.getSnapshot()).toMatchObject({
      status: 'error',
      error: expect.stringContaining('retry'),
    })
    await f.session.reload()
    expect(f.session.getSnapshot().status).toBe('ready')
    f.stop()
  })
  it('stops late reads and subscriptions, and restarts safely for StrictMode', async () => {
    const f = await fixture()
    const pending = deferred<VfsResult<readonly FileSystemNode[]>>()
    const list = vi
      .spyOn(f.workspace.vfs, 'listDirectory')
      .mockImplementationOnce(() => pending.promise)
    const reading = f.session.reload()
    f.session.stop()
    const snapshot = f.session.getSnapshot()
    pending.resolve({ ok: true, value: [] })
    await reading
    expect(f.session.getSnapshot()).toBe(snapshot)
    list.mockClear()
    await f.workspace.vfs.createDirectory(f.home, 'Later')
    await f.workspace.refresh.request()
    expect(list).not.toHaveBeenCalled()
    f.session.start()
    await vi.waitFor(() => expect(f.session.getSnapshot().status).toBe('ready'))
    expect(
      f.session.getSnapshot().entries.some((node) => node.name === 'Later'),
    ).toBe(true)
    f.stop()
  })
  it('falls back to the root if the home path cannot be found', async () => {
    const f = await fixture()
    vi.spyOn(f.workspace.vfs, 'resolve').mockResolvedValueOnce({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Missing' },
    })
    await f.session.home()
    expect(f.session.getSnapshot()).toMatchObject({
      directoryId: ROOT_NODE_ID,
      status: 'ready',
      notice: expect.stringContaining('unavailable'),
    })
    f.stop()
  })
})

it('does not let a slow Home lookup overwrite a later folder navigation', async () => {
  const f = await fixture()
  const pending =
    deferred<VfsResult<import('../../core/filesystem/types').NodeId>>()
  vi.spyOn(f.workspace.vfs, 'resolve').mockImplementationOnce(
    () => pending.promise,
  )
  const home = f.session.home()
  await f.session.navigate(f.desktop)
  pending.resolve({ ok: true, value: f.home })
  await home
  expect(f.session.getSnapshot().directoryId).toBe(f.desktop)
  f.stop()
})
