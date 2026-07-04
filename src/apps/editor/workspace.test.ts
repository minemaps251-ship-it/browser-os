import { afterEach, expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { createEditorWorkspace, MAX_EDITOR_TABS } from './workspace'
import type { NodeId } from '../../core/filesystem/types'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { deferred } from '../../test/fixtures'
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop())
})
async function fixture() {
  const services = temporaryWorkspace()
  const home = await services.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const create = async (name: string, text = '') => {
    const file = await services.vfs.createFile(home.value, name, {
      kind: 'text',
      encoding: 'utf-8',
      text,
    })
    if (!file.ok) throw new Error('Create failed')
    return file.value
  }
  const one = await create('one.txt', 'one')
  const two = await create('two.txt', 'two')
  const workspace = createEditorWorkspace(services.vfs, services.refresh, one)
  workspace.start()
  const ready = async () => {
    await vi.waitFor(() =>
      expect(
        workspace
          .getSnapshot()
          .tabs.every((tab) => tab.session.getSnapshot().status === 'ready'),
      ).toBe(true),
    )
  }
  await ready()
  cleanup.push(() => {
    workspace.stop()
    services.dispose()
  })
  return { workspace, services, one, two, home: home.value, ready }
}
it('retains independent sessions, stable-ID rename/dedup, and Save As bindings', async () => {
  const { workspace, services, one, two, home, ready } = await fixture()
  const first = workspace.getSnapshot().tabs[0]
  first.session.edit('one draft')
  expect(workspace.openFile(two)).toBe(true)
  await ready()
  const second = workspace.getSnapshot().tabs[1]
  second.session.edit('two draft')
  expect(workspace.openFile(one)).toBe(true)
  expect(workspace.getSnapshot().activeId).toBe(first.id)
  expect(workspace.getSnapshot().tabs).toHaveLength(2)
  await services.vfs.rename(one, 'renamed.txt')
  await vi.waitFor(() =>
    expect(first.session.getSnapshot()).toMatchObject({
      name: 'renamed.txt',
      buffer: 'one draft',
    }),
  )
  const created = await first.session.saveAs(home, 'copy.txt')
  if (!created.ok) throw new Error('Save As failed')
  expect(workspace.openFile(created.value)).toBe(true)
  expect(workspace.getSnapshot().tabs).toHaveLength(2)
  expect(workspace.openFile(one)).toBe(true)
  await ready()
  expect(workspace.getSnapshot().tabs).toHaveLength(3)
  expect(second.session.getSnapshot()).toMatchObject({
    buffer: 'two draft',
    dirty: true,
  })
  expect(await second.session.save()).toBe(true)
  expect(await services.vfs.readFile(two)).toMatchObject({
    ok: true,
    value: { content: { text: 'two draft' } },
  })
})
it('cancels aggregate close without deleting earlier discarded drafts or reusing their approvals', async () => {
  const { workspace, two, ready } = await fixture()
  const first = workspace.getSnapshot().tabs[0]
  workspace.openFile(two)
  await ready()
  const second = workspace.getSnapshot().tabs[1]
  first.session.edit('first unsaved')
  second.session.edit('second unsaved')
  const close = workspace.requestCloseWindow()
  await vi.waitFor(() =>
    expect(first.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  expect(workspace.newDocument()).toBe(false)
  expect(workspace.openFile(two)).toBe(false)
  first.session.discardClose()
  await vi.waitFor(() =>
    expect(second.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  second.session.cancelClose()
  expect(await close).toBe(false)
  expect(workspace.getSnapshot().tabs).toHaveLength(2)
  expect(first.session.getSnapshot()).toMatchObject({
    buffer: 'first unsaved',
    dirty: true,
  })
  const again = workspace.requestCloseWindow()
  await vi.waitFor(() =>
    expect(first.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  await first.session.saveAndClose()
  await vi.waitFor(() =>
    expect(second.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  second.session.discardClose()
  expect(await again).toBe(true)
  expect(first.session.getSnapshot()).toMatchObject({ dirty: false })
})
it('asks again if an earlier approved document changes while another close dialog is pending', async () => {
  const { workspace, two, ready } = await fixture()
  const first = workspace.getSnapshot().tabs[0]
  workspace.openFile(two)
  await ready()
  const second = workspace.getSnapshot().tabs[1]
  first.session.edit('first')
  second.session.edit('second')
  const close = workspace.requestCloseWindow()
  await vi.waitFor(() =>
    expect(first.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  first.session.discardClose()
  await vi.waitFor(() =>
    expect(second.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  first.session.edit('new first edit')
  second.session.discardClose()
  await vi.waitFor(() =>
    expect(first.session.getSnapshot()).toMatchObject({
      closing: true,
      buffer: 'new first edit',
    }),
  )
  first.session.cancelClose()
  expect(await close).toBe(false)
})
it('closes one tab only after the newest text has been saved, preserves pending edits and rejects parallel operations', async () => {
  const { workspace, services, one } = await fixture()
  const first = workspace.getSnapshot().tabs[0]
  first.session.edit('captured')
  const gate = deferred<void>()
  const original = services.vfs.writeFile
  vi.spyOn(services.vfs, 'writeFile').mockImplementation(async (...args) => {
    await gate.promise
    return original(...args)
  })
  const close = workspace.requestCloseTab(first.id)
  await vi.waitFor(() =>
    expect(first.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  const saving = first.session.saveAndClose()
  first.session.edit('newer')
  expect(await workspace.requestCloseTab(first.id)).toBe(false)
  expect(await workspace.requestCloseWindow()).toBe(false)
  gate.resolve()
  await saving
  expect(first.session.getSnapshot()).toMatchObject({
    dirty: true,
    buffer: 'newer',
    closing: true,
  })
  expect(await services.vfs.readFile(one)).toMatchObject({
    ok: true,
    value: { content: { text: 'captured' } },
  })
  await first.session.saveAndClose()
  expect(await close).toBe(true)
  expect(workspace.getSnapshot().tabs).toHaveLength(0)
  expect(workspace.newDocument()).toBe(true)
})
it('keeps a failed save open and invalidates a pending close on stop/restart', async () => {
  const { workspace, services } = await fixture()
  const tab = workspace.getSnapshot().tabs[0]
  tab.session.edit('retained')
  vi.spyOn(services.vfs, 'writeFile').mockResolvedValue({
    ok: false,
    error: { code: 'QUOTA', message: 'Full' },
  })
  const close = workspace.requestCloseTab(tab.id)
  await vi.waitFor(() =>
    expect(tab.session.getSnapshot()).toMatchObject({ closing: true }),
  )
  await tab.session.saveAndClose()
  expect(tab.session.getSnapshot()).toMatchObject({
    dirty: true,
    buffer: 'retained',
    closing: true,
  })
  workspace.stop()
  workspace.start()
  expect(await close).toBe(false)
  expect(workspace.getSnapshot().tabs).toHaveLength(1)
  expect(tab.session.getSnapshot()).toMatchObject({ buffer: 'retained' })
})
it('bounds tab count, still selects existing documents at the limit, blocks modal delivery and cleans subscriptions', async () => {
  const { workspace, one, services } = await fixture()
  for (let i = 1; i < MAX_EDITOR_TABS; i++)
    expect(workspace.newDocument()).toBe(true)
  expect(workspace.newDocument()).toBe(false)
  expect(workspace.getSnapshot().notice).toContain('limit 20')
  expect(workspace.openFile(one)).toBe(true)
  workspace.setModalOpen(true)
  expect(workspace.openFile(one)).toBe(false)
  expect(await workspace.requestCloseWindow()).toBe(false)
  workspace.setModalOpen(false)
  const observer = vi.fn()
  const off = workspace.subscribe(observer)
  workspace.stop()
  observer.mockClear()
  await services.vfs.rename(one, 'after-stop.txt')
  await Promise.resolve()
  expect(observer).not.toHaveBeenCalled()
  expect(workspace.openFile('missing' as NodeId)).toBe(false)
  off()
})

it('does not start a deferred tab close after disposal and keeps an approved window locked', async () => {
  const { workspace } = await fixture()
  const close = workspace.requestCloseTab(workspace.getSnapshot().tabs[0].id)
  workspace.stop()
  expect(await close).toBe(false)
  workspace.start()
  expect(await workspace.requestCloseWindow()).toBe(true)
  expect(workspace.newDocument()).toBe(false)
})
