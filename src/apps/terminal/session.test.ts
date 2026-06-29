import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { createTerminalSession } from './session'
import { executeCommand } from './commands'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
async function ready(session: ReturnType<typeof createTerminalSession>) {
  await vi.waitFor(() => expect(session.getSnapshot().status).toBe('ready'))
}
it('supports real pwd/ls/cd/help, quoted paths and independent session cwd', async () => {
  const workspace = temporaryWorkspace()
  const a = createTerminalSession(workspace.vfs, workspace.refresh)
  const b = createTerminalSession(workspace.vfs, workspace.refresh)
  a.start()
  b.start()
  try {
    await ready(a)
    await ready(b)
    await a.run('pwd')
    expect(a.getSnapshot().entries.at(-1)?.stdout).toBe('/home/user')
    await a.run('ls')
    expect(a.getSnapshot().entries.at(-1)?.stdout).toContain('Documents/')
    const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
    if (!home.ok) throw new Error('Missing home')
    await workspace.vfs.createDirectory(home.value, 'My folder')
    await ready(a)
    await a.run('cd "My folder"')
    expect(a.getSnapshot().path).toBe('/home/user/My folder')
    expect(b.getSnapshot().path).toBe('/home/user')
    await a.run('cd ..')
    await a.run('cd')
    await a.run('help')
    expect(a.getSnapshot().entries.at(-1)?.stdout).toContain('pwd')
    await a.run('unknown')
    expect(a.getSnapshot().entries.at(-1)?.exitCode).toBe(127)
    await a.run('pwd too many')
    expect(a.getSnapshot().entries.at(-1)?.exitCode).toBe(2)
    await a.run('ls | pwd')
    expect(a.getSnapshot().entries.at(-1)?.stderr).toContain('operators')
  } finally {
    a.stop()
    b.stop()
    workspace.dispose()
  }
})
it('tracks moved/renamed cwd by ID and returns home when removed', async () => {
  const workspace = temporaryWorkspace()
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await ready(session)
    await session.run('cd Documents')
    const id = session.getSnapshot().directoryId!
    await workspace.vfs.rename(id, 'Work')
    await vi.waitFor(() =>
      expect(session.getSnapshot().path).toBe('/home/user/Work'),
    )
    await workspace.vfs.remove(id, { recursive: false })
    await vi.waitFor(() =>
      expect(session.getSnapshot().path).toBe('/home/user'),
    )
    expect(session.getSnapshot().notice).toContain('removed')
    await session.run('pwd')
    expect(session.getSnapshot().entries.at(-1)?.stdout).toBe('/home/user')
  } finally {
    session.stop()
    workspace.dispose()
  }
})
it('cancels slow reads without changing cwd and ignores late work after stop/restart', async () => {
  const workspace = temporaryWorkspace()
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await ready(session)
    const original = workspace.vfs.resolve
    const gate = deferred<Awaited<ReturnType<typeof original>>>()
    vi.spyOn(workspace.vfs, 'resolve').mockReturnValueOnce(gate.promise)
    const command = session.run('cd Documents')
    await vi.waitFor(() => expect(session.getSnapshot().status).toBe('busy'))
    expect(await session.run('pwd')).toBe(false)
    session.cancel()
    gate.resolve(
      await original('Documents', session.getSnapshot().directoryId!),
    )
    await command
    expect(session.getSnapshot().path).toBe('/home/user')
    expect(session.getSnapshot().entries.at(-1)?.exitCode).toBe(130)
    const late = deferred<Awaited<ReturnType<typeof workspace.vfs.pathOf>>>()
    vi.spyOn(workspace.vfs, 'pathOf').mockReturnValueOnce(late.promise)
    const stale = session.run('pwd')
    session.stop()
    session.start()
    await ready(session)
    late.resolve({ ok: true, value: '/stale' })
    await stale
    expect(session.getSnapshot().path).toBe('/home/user')
    expect(session.getSnapshot().entries).toHaveLength(1)
  } finally {
    session.stop()
    workspace.dispose()
  }
})
it('bounds transcript and recovers after a read failure', async () => {
  const workspace = temporaryWorkspace()
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await ready(session)
    for (let i = 0; i < 45; i++) await session.run('help')
    expect(session.getSnapshot().entries.length).toBeLessThanOrEqual(40)
    expect(session.getSnapshot().trimmed).toBe(true)
    vi.spyOn(workspace.vfs, 'pathOf').mockRejectedValueOnce(
      new Error('private exception'),
    )
    await session.run('pwd')
    expect(session.getSnapshot().status).toBe('error')
    await session.retry()
    await ready(session)
    await session.run('pwd')
    expect(session.getSnapshot().entries.at(-1)?.exitCode).toBe(0)
  } finally {
    session.stop()
    workspace.dispose()
  }
})
it('reports a file used as cd target and errors without altering cwd', async () => {
  const workspace = temporaryWorkspace()
  const file = await workspace.vfs.createFile(ROOT_NODE_ID, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!file.ok) throw new Error('Create failed')
  const signal = new AbortController().signal
  expect(
    await executeCommand(
      ['cd', '/note.txt'],
      ROOT_NODE_ID,
      workspace.vfs,
      signal,
    ),
  ).toMatchObject({ exitCode: 1, stderr: 'cd: Not a folder.' })
  expect(
    await executeCommand(
      ['ls', '/missing'],
      ROOT_NODE_ID,
      workspace.vfs,
      signal,
    ),
  ).toMatchObject({ exitCode: 1 })
  expect(
    await executeCommand(
      ['ls', '/note.txt'],
      ROOT_NODE_ID,
      workspace.vfs,
      signal,
    ),
  ).toMatchObject({ exitCode: 1 })
  workspace.dispose()
})

it('caps a large listing instead of keeping unbounded output', async () => {
  const workspace = temporaryWorkspace()
  const home = await workspace.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  for (let i = 0; i < 60; i++)
    await workspace.vfs.createFile(home.value, `${i}-${'x'.repeat(240)}`, {
      kind: 'text',
      encoding: 'utf-8',
      text: '',
    })
  const session = createTerminalSession(workspace.vfs, workspace.refresh)
  session.start()
  try {
    await ready(session)
    await session.run('ls')
    const entry = session.getSnapshot().entries.at(-1)!
    expect(entry.stdout).toContain('[Output truncated]')
    expect(entry.stdout.length).toBeLessThan(12100)
  } finally {
    session.stop()
    workspace.dispose()
  }
})
