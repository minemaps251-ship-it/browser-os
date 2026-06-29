import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
import { executeCommand } from './commands'
import { createTerminalSession } from './session'

it('copies text independently and moves/renames files and folders with stable IDs', async () => {
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
  const resolve = async (path: string) => {
    const result = await workspace.vfs.resolve(path, home.value)
    if (!result.ok) throw new Error(path)
    return result.value
  }
  try {
    await run(['touch', 'original.txt'])
    const original = await resolve('original.txt')
    await workspace.vfs.writeFile(
      original,
      { kind: 'text', encoding: 'utf-8', text: 'Hello 🌍' },
      { expectedContentRevision: 1, requestId: 'transfer-test' },
    )
    expect((await run(['cp', 'original.txt', 'Documents/'])).exitCode).toBe(0)
    const copy = await resolve('Documents/original.txt')
    expect(copy).not.toBe(original)
    expect(await workspace.vfs.readFile(copy)).toMatchObject({
      ok: true,
      value: { content: { text: 'Hello 🌍' } },
    })
    expect((await run(['cp', 'original.txt', './new name.txt'])).exitCode).toBe(
      0,
    )
    expect((await run(['mv', 'original.txt', 'renamed.txt'])).exitCode).toBe(0)
    expect(await resolve('renamed.txt')).toBe(original)
    expect(
      (await run(['mv', 'renamed.txt', '/home/user/Desktop'])).exitCode,
    ).toBe(0)
    expect(await resolve('Desktop/renamed.txt')).toBe(original)
    await run(['mkdir', 'Documents/folder'])
    await run(['touch', 'Documents/folder/child'])
    const folder = await resolve('Documents/folder')
    expect(
      (await run(['mv', 'Documents/folder', 'Desktop/new folder'])).exitCode,
    ).toBe(0)
    expect(await resolve('Desktop/new folder')).toBe(folder)
    expect(
      await workspace.vfs.resolve('Desktop/new folder/child', home.value),
    ).toMatchObject({ ok: true })
    expect(await workspace.vfs.readFile(original)).toMatchObject({
      ok: true,
      value: { content: { text: 'Hello 🌍' } },
    })
  } finally {
    workspace.dispose()
  }
})

it('rejects overwrite, folder copy, cycles, protection and invalid destinations without changing data', async () => {
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
    await run(['touch', 'a'])
    await run(['touch', 'b'])
    await run(['mkdir', 'folder'])
    await run(['mkdir', 'folder/child'])
    const listener = vi.fn()
    const unsubscribe = workspace.vfs.subscribe({ kind: 'all' }, listener)
    for (const args of [
      ['cp', 'a', 'b'],
      ['mv', 'a', 'b'],
      ['cp', 'a', 'a'],
      ['cp', 'folder', 'copy'],
      ['mv', 'folder', 'folder/child'],
      ['mv', '/home/user', 'elsewhere'],
      ['cp', 'a', '/system/no'],
      ['cp', 'a', 'missing/child'],
      ['mv', 'a', 'missing/'],
      ['cp', 'a', 'b/child'],
      ['mv', 'missing', 'new'],
      ['cp', 'a', ''],
    ])
      expect((await run(args)).exitCode).toBe(1)
    for (const args of [['cp'], ['mv', 'a'], ['cp', 'a', 'b', 'c']])
      expect((await run(args)).exitCode).toBe(2)
    expect(listener).not.toHaveBeenCalled()
    expect(await workspace.vfs.resolve('a', home.value)).toMatchObject({
      ok: true,
    })
    expect(
      await workspace.vfs.resolve('folder/child', home.value),
    ).toMatchObject({ ok: true })
    unsubscribe()
  } finally {
    workspace.dispose()
  }
})

it('cancels before dispatch and reports actual commit while tracking a moved cwd in another session', async () => {
  const workspace = temporaryWorkspace()
  const first = createTerminalSession(workspace.vfs, workspace.refresh)
  const second = createTerminalSession(workspace.vfs, workspace.refresh)
  first.start()
  second.start()
  try {
    await vi.waitFor(() => expect(first.getSnapshot().status).toBe('ready'))
    await vi.waitFor(() => expect(second.getSnapshot().status).toBe('ready'))
    await first.run('mkdir Documents/work')
    await second.run('cd Documents/work')
    const originalMove = workspace.vfs.move
    const gate = deferred<void>()
    const move = vi
      .spyOn(workspace.vfs, 'move')
      .mockImplementation(async (...args) => {
        await gate.promise
        return originalMove(...args)
      })
    const pending = first.run('mv Documents/work Desktop/renamed')
    await vi.waitFor(() => expect(move).toHaveBeenCalledOnce())
    expect(first.getSnapshot().cancellable).toBe(false)
    first.cancel()
    gate.resolve()
    await pending
    expect(first.getSnapshot().entries.at(-1)?.exitCode).toBe(0)
    await vi.waitFor(() =>
      expect(second.getSnapshot().path).toBe('/home/user/Desktop/renamed'),
    )
    const controller = new AbortController()
    const resolve = workspace.vfs.resolve
    vi.spyOn(workspace.vfs, 'resolve').mockImplementationOnce(
      async (...args) => {
        controller.abort()
        return resolve(...args)
      },
    )
    expect(
      (
        await executeCommand(
          ['mv', 'Desktop/renamed', 'Documents'],
          first.getSnapshot().directoryId!,
          workspace.vfs,
          controller.signal,
        )
      ).exitCode,
    ).toBe(130)
    expect(move).toHaveBeenCalledOnce()
  } finally {
    first.stop()
    second.stop()
    workspace.dispose()
  }
})

it('revalidates destinations at commit and exposes storage failures without success', async () => {
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
    await run(['touch', 'source'])
    const original = workspace.vfs.copyFile
    vi.spyOn(workspace.vfs, 'copyFile').mockImplementationOnce(
      async (source, parent, name) => {
        await workspace.vfs.touchFile(parent, name!)
        return original(source, parent, name)
      },
    )
    expect(await run(['cp', 'source', 'raced'])).toMatchObject({
      exitCode: 1,
      mutationStarted: true,
      stderr: expect.stringContaining('already exists'),
    })
    vi.spyOn(workspace.vfs, 'copyFile').mockResolvedValueOnce({
      ok: false,
      error: { code: 'QUOTA', message: 'quota' },
    })
    expect(await run(['cp', 'source', 'failed'])).toMatchObject({
      exitCode: 1,
      mutationStarted: true,
      stderr: expect.stringContaining('storage is full'),
    })
    const move = workspace.vfs.move
    vi.spyOn(workspace.vfs, 'move').mockImplementationOnce(
      async (source, parent, name) => {
        await workspace.vfs.remove(parent, { recursive: true })
        return move(source, parent, name)
      },
    )
    expect(await run(['mv', 'source', 'Documents/new'])).toMatchObject({
      exitCode: 1,
      mutationStarted: true,
    })
    expect(await workspace.vfs.resolve('source', home.value)).toMatchObject({
      ok: true,
    })
    expect(await workspace.vfs.resolve('failed', home.value)).toMatchObject({
      ok: false,
    })
  } finally {
    workspace.dispose()
  }
})
