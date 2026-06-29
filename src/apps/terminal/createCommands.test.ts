import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { executeCommand } from './commands'
import { createTerminalSession } from './session'
import { deferred } from '../../test/fixtures'
it('creates nested paths with spaces, touches existing text safely and reports errors', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const command = (args: string[]) =>
    executeCommand(
      args,
      home.value,
      workspace.vfs,
      new AbortController().signal,
    )
  try {
    expect((await command(['mkdir', 'My folder'])).exitCode).toBe(0)
    expect((await command(['touch', 'My folder/note.txt'])).exitCode).toBe(0)
    const file = await workspace.vfs.resolve('My folder/note.txt', home.value)
    if (!file.ok) throw new Error('Missing file')
    await workspace.vfs.writeFile(
      file.value,
      { kind: 'text', encoding: 'utf-8', text: 'Keep me' },
      { expectedContentRevision: 1, requestId: 'test-save' },
    )
    expect((await command(['touch', 'My folder/note.txt'])).exitCode).toBe(0)
    const read = await workspace.vfs.readFile(file.value)
    expect(read.ok && read.value.content.text).toBe('Keep me')
    expect(read.ok && read.value.contentRevision).toBe(2)
    for (const args of [
      ['touch'],
      ['mkdir'],
      ['touch', 'a', 'b'],
      ['touch', 'folder/'],
      ['mkdir', '.'],
    ])
      expect((await command(args)).exitCode).toBe(2)
    expect((await command(['touch', 'My folder'])).stderr).toContain(
      'not a file',
    )
    expect((await command(['mkdir', 'My folder'])).stderr).toContain(
      'already exists',
    )
    expect((await command(['touch', 'missing/file'])).stderr).toContain(
      'No such',
    )
    expect((await command(['touch', '/system/no.txt'])).stderr).toContain(
      'protected',
    )
  } finally {
    workspace.dispose()
  }
})
it('does not dispatch when cancelled during parent resolution, and does not report a committed mutation as cancelled', async () => {
  const workspace = temporaryWorkspace()
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    const original = workspace.vfs.touchFile
    const gate = deferred<void>()
    const touch = vi
      .spyOn(workspace.vfs, 'touchFile')
      .mockImplementation(async (parent, name) => {
        await gate.promise
        return original(parent, name)
      })
    const pending = session.run('touch committed.txt')
    await vi.waitFor(() => expect(touch).toHaveBeenCalledOnce())
    expect(session.getSnapshot().cancellable).toBe(false)
    session.cancel()
    gate.resolve()
    await pending
    expect(session.getSnapshot().entries.at(-1)?.exitCode).toBe(0)
    const created = await workspace.vfs.resolve(
      '/home/user/committed.txt',
      ROOT_NODE_ID,
    )
    expect(created.ok).toBe(true)
    const controller = new AbortController()
    const resolve = workspace.vfs.resolve
    vi.spyOn(workspace.vfs, 'resolve').mockImplementationOnce(
      async (path, cwd) => {
        controller.abort()
        return resolve(path, cwd)
      },
    )
    expect(
      (
        await executeCommand(
          ['touch', 'cancelled.txt'],
          session.getSnapshot().directoryId!,
          workspace.vfs,
          controller.signal,
        )
      ).exitCode,
    ).toBe(130)
    expect(touch).toHaveBeenCalledOnce()
  } finally {
    session.stop()
    workspace.dispose()
  }
})
