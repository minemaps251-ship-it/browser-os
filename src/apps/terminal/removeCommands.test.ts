import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
import { executeCommand } from './commands'
import { createTerminalSession } from './session'

it('removes one file or empty folder and requires explicit recursion for nonempty folders', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const run = (args: string[]) =>
    executeCommand(
      args,
      home.value,
      workspace.vfs,
      new AbortController().signal,
    )
  try {
    await run(['mkdir', 'Work 🌍'])
    await run(['touch', 'Work 🌍/keep.txt'])
    const file = await workspace.vfs.resolve('Work 🌍/keep.txt', home.value)
    if (!file.ok) throw new Error('Missing file')
    await workspace.vfs.writeFile(
      file.value,
      { kind: 'text', encoding: 'utf-8', text: 'Keep 🌍' },
      { expectedContentRevision: 1, requestId: 'rm-test' },
    )
    const listener = vi.fn()
    const off = workspace.vfs.subscribe({ kind: 'all' }, listener)
    expect(await run(['rm', 'Work 🌍'])).toMatchObject({
      exitCode: 1,
      stderr: expect.stringContaining('rm -r'),
    })
    expect(listener).not.toHaveBeenCalled()
    expect(await workspace.vfs.readFile(file.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Keep 🌍' } },
    })
    expect((await run(['rm', './Work 🌍/keep.txt'])).exitCode).toBe(0)
    expect(await workspace.vfs.readFile(file.value)).toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND' },
    })
    expect((await run(['rm', 'Work 🌍/'])).exitCode).toBe(0)
    await run(['mkdir', 'Documents/tree'])
    await run(['mkdir', 'Documents/tree/sub'])
    await run(['touch', 'Documents/tree/sub/note'])
    expect(
      (await run(['rm', '-r', '/home/user/Documents/tree'])).exitCode,
    ).toBe(0)
    expect(
      await workspace.vfs.resolve('Documents/tree', home.value),
    ).toMatchObject({ ok: false })
    off()
  } finally {
    workspace.dispose()
  }
})

it('rejects malformed options, missing paths and protected elements; supports literal dash names', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const run = (args: string[]) =>
    executeCommand(
      args,
      home.value,
      workspace.vfs,
      new AbortController().signal,
    )
  try {
    await run(['touch', '-r'])
    const remove = vi.spyOn(workspace.vfs, 'remove')
    for (const args of [
      [],
      ['-r'],
      ['--'],
      ['-r', '--'],
      ['-f', 'a'],
      ['-rf', 'a'],
      ['a', 'b'],
      ['a', '-r'],
      ['-r', '-r'],
    ])
      expect((await run(['rm', ...args])).exitCode).toBe(2)
    expect(remove).not.toHaveBeenCalled()
    expect((await run(['rm', ''])).exitCode).toBe(1)
    expect((await run(['rm', 'missing'])).stderr).toContain('No such')
    expect((await run(['rm', '-r', '/'])).stderr).toContain('protected')
    expect((await run(['rm', '-r', '/home/user'])).stderr).toContain(
      'protected',
    )
    expect((await run(['rm', '-r', '/system'])).stderr).toContain('protected')
    expect(await workspace.vfs.resolve('-r', home.value)).toMatchObject({
      ok: true,
    })
    expect((await run(['rm', '--', '-r'])).exitCode).toBe(0)
    expect(await workspace.vfs.resolve('-r', home.value)).toMatchObject({
      ok: false,
    })
  } finally {
    workspace.dispose()
  }
})

it('recovers own and another session cwd after deleting the current subtree', async () => {
  const workspace = temporaryWorkspace()
  const first = createTerminalSession(workspace.vfs, workspace.refresh)
  const second = createTerminalSession(workspace.vfs, workspace.refresh)
  first.start()
  second.start()
  try {
    await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'))
    await vi.waitFor(() => expect(second.getSnapshot().status).toBe('ready'))
    await first.run('mkdir Documents/work')
    await first.run('mkdir Documents/work/sub')
    await second.run('cd Documents/work/sub')
    await first.run('cd Documents/work')
    await first.run('rm -r .')
    expect(first.getSnapshot().path).toBe('/home/user')
    expect(first.getSnapshot().notice).toContain('removed')
    expect(first.getSnapshot().entries.at(-1)?.exitCode).toBe(0)
    await vi.waitFor(() => expect(second.getSnapshot().path).toBe('/home/user'))
    expect(second.getSnapshot().notice).toContain('removed')
  } finally {
    first.stop()
    second.stop()
    workspace.dispose()
  }
})

it('cancels before dispatch, keeps commit results and ignores late completion after closing', async () => {
  const workspace = temporaryWorkspace()
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    await session.run('touch target')
    const controller = new AbortController()
    const resolve = workspace.vfs.resolve
    vi.spyOn(workspace.vfs, 'resolve').mockImplementationOnce(
      async (...args) => {
        controller.abort()
        return resolve(...args)
      },
    )
    const original = workspace.vfs.remove
    const remove = vi.spyOn(workspace.vfs, 'remove')
    expect(
      (
        await executeCommand(
          ['rm', 'target'],
          session.getSnapshot().directoryId!,
          workspace.vfs,
          controller.signal,
        )
      ).exitCode,
    ).toBe(130)
    expect(remove).not.toHaveBeenCalled()
    const gate = deferred<void>()
    remove.mockImplementationOnce(async (...args) => {
      await gate.promise
      return original(...args)
    })
    const pending = session.run('rm target')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    expect(session.getSnapshot().cancellable).toBe(false)
    session.cancel()
    gate.resolve()
    await pending
    expect(session.getSnapshot().entries.at(-1)?.exitCode).toBe(0)
    await session.run('touch late')
    const lateGate = deferred<void>()
    remove.mockImplementationOnce(async (...args) => {
      await lateGate.promise
      return original(...args)
    })
    const late = session.run('rm late')
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(2))
    session.stop()
    const before = session.getSnapshot()
    lateGate.resolve()
    await late
    expect(session.getSnapshot()).toBe(before)
    expect(
      await workspace.vfs.resolve('/home/user/late', ROOT_NODE_ID),
    ).toMatchObject({ ok: false })
  } finally {
    session.stop()
    workspace.dispose()
  }
})

it('reports deleted targets and storage errors without publishing success or deleting replacement data', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const run = (args: string[]) =>
    executeCommand(
      args,
      home.value,
      workspace.vfs,
      new AbortController().signal,
    )
  try {
    await run(['touch', 'target'])
    const original = workspace.vfs.remove
    const remove = vi
      .spyOn(workspace.vfs, 'remove')
      .mockImplementationOnce(async (id, options) => {
        await original(id, options)
        await workspace.vfs.touchFile(home.value, 'target')
        return original(id, options)
      })
    expect(await run(['rm', 'target'])).toMatchObject({
      exitCode: 1,
      mutationStarted: true,
      stderr: expect.stringContaining('No such'),
    })
    expect(await workspace.vfs.resolve('target', home.value)).toMatchObject({
      ok: true,
    })
    for (const code of ['QUOTA', 'STORAGE_UNAVAILABLE'] as const) {
      remove.mockResolvedValueOnce({
        ok: false,
        error: { code, message: 'Storage error' },
      })
      expect(await run(['rm', 'target'])).toMatchObject({
        exitCode: 1,
        mutationStarted: true,
      })
      expect(await workspace.vfs.resolve('target', home.value)).toMatchObject({
        ok: true,
      })
    }
  } finally {
    workspace.dispose()
  }
})
