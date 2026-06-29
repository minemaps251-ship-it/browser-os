import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { executeCommand } from './commands'
import { createTerminalSession } from './session'
import { parseCommand } from './parser'
import { deferred } from '../../test/fixtures'
it('reads quoted text paths and keeps echo literal with no filesystem writes', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const file = await workspace.vfs.createFile(home.value, 'read me.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Привет 🌍\nsecond line',
  })
  if (!file.ok) throw new Error('Create failed')
  const execute = (tokens: string[]) =>
    executeCommand(
      tokens,
      home.value,
      workspace.vfs,
      new AbortController().signal,
    )
  try {
    expect(await execute(['cat', 'read me.txt'])).toMatchObject({
      stdout: 'Привет 🌍\nsecond line',
      stderr: '',
      exitCode: 0,
    })
    const changes = vi.fn()
    const off = workspace.vfs.subscribe({ kind: 'all' }, changes)
    const parsed = parseCommand(
      'echo "<script>alert(1)</script>" "$HOME" "> file"',
    )
    if (!parsed.ok) throw new Error('Parse failed')
    expect(await execute([...parsed.tokens])).toMatchObject({
      stdout: '<script>alert(1)</script> $HOME > file',
      exitCode: 0,
    })
    expect(await execute(['echo'])).toMatchObject({ stdout: '', exitCode: 0 })
    expect(await execute(['echo', '-n', 'text'])).toMatchObject({
      stdout: '-n text',
    })
    expect(changes).not.toHaveBeenCalled()
    off()
    expect(await execute(['cat'])).toMatchObject({ exitCode: 2 })
    expect(await execute(['cat', 'a', 'b'])).toMatchObject({ exitCode: 2 })
    expect(await execute(['cat', 'Documents'])).toMatchObject({
      exitCode: 1,
      stderr: 'cat: Existing item is not a file.',
    })
    expect(await execute(['cat', 'missing'])).toMatchObject({ exitCode: 1 })
    vi.spyOn(workspace.vfs, 'readFile').mockResolvedValueOnce({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'private' },
    })
    expect(await execute(['cat', 'read me.txt'])).toMatchObject({
      exitCode: 1,
      stderr: 'cat: Storage is unavailable. Try again.',
    })
  } finally {
    workspace.dispose()
  }
})
it('caps cat output and clears only one transcript without changing cwd or stored text', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const source = 'x'.repeat(15000)
  const file = await workspace.vfs.createFile(home.value, 'large.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: source,
  })
  if (!file.ok) throw new Error('Create failed')
  const a = createTerminalSession(workspace.vfs, workspace.refresh),
    b = createTerminalSession(workspace.vfs, workspace.refresh)
  a.start()
  b.start()
  try {
    await vi.waitFor(() => expect(a.getSnapshot().status).toBe('ready'))
    await vi.waitFor(() => expect(b.getSnapshot().status).toBe('ready'))
    await a.run('cat large.txt')
    expect(a.getSnapshot().entries.at(-1)?.stdout).toContain(
      '[Output truncated]',
    )
    expect(a.getSnapshot().entries.at(-1)?.stdout.length).toBeLessThan(12100)
    await b.run('echo keep')
    await a.run('cd Documents')
    const cwd = a.getSnapshot().directoryId
    for (let i = 0; i < 45; i++) await a.run('echo old')
    expect(a.getSnapshot().trimmed).toBe(true)
    await a.run('clear unexpected')
    expect(a.getSnapshot().entries.at(-1)?.exitCode).toBe(2)
    expect(a.getSnapshot().entries.length).toBeGreaterThan(0)
    await a.run('clear')
    expect(a.getSnapshot().entries).toHaveLength(0)
    expect(a.getSnapshot().trimmed).toBe(false)
    expect(a.getSnapshot().notice).toBe('Terminal output cleared.')
    expect(a.getSnapshot().directoryId).toBe(cwd)
    expect(a.getSnapshot().path).toBe('/home/user/Documents')
    expect(b.getSnapshot().entries.at(-1)?.stdout).toBe('keep')
    const read = await workspace.vfs.readFile(file.value)
    expect(read.ok && read.value.content.text).toBe(source)
  } finally {
    a.stop()
    b.stop()
    workspace.dispose()
  }
})
it('cancels pending cat and ignores late reads after closing a session', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  await workspace.vfs.createFile(home.value, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Do not show',
  })
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    const original = workspace.vfs.readFile
    let gate = deferred<void>()
    const read = vi
      .spyOn(workspace.vfs, 'readFile')
      .mockImplementation(async (id) => {
        await gate.promise
        return original(id)
      })
    const pending = session.run('cat note.txt')
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    session.cancel()
    gate.resolve()
    await pending
    expect(session.getSnapshot().entries.at(-1)).toMatchObject({
      stdout: '',
      exitCode: 130,
    })
    gate = deferred<void>()
    const late = session.run('cat note.txt')
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    session.stop()
    gate.resolve()
    await late
    expect(session.getSnapshot().entries).toHaveLength(1)
  } finally {
    session.stop()
    workspace.dispose()
  }
})

it('does not clear prior output if clear is cancelled before execution', async () => {
  const workspace = temporaryWorkspace()
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
    await session.run('echo keep')
    const off = session.subscribe(() => {
      if (session.getSnapshot().status === 'busy') session.cancel()
    })
    await session.run('clear')
    off()
    expect(session.getSnapshot().entries[0].stdout).toBe('keep')
    expect(session.getSnapshot().entries.at(-1)?.exitCode).toBe(130)
  } finally {
    session.stop()
    workspace.dispose()
  }
})
