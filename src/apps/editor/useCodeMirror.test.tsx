import { StrictMode, useSyncExternalStore } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { createEditorWorkspace, type EditorWorkspace } from './workspace'
import { createEngineOwner, type EngineOwner } from './engine/owner'
import type { EngineHandle, EngineModule, EnginePool } from './engine/types'
import { useCodeMirror } from './useCodeMirror'
import { deferred } from '../../test/fixtures'
const stops: (() => void)[] = []
afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
})
function Harness({
  workspace,
  owner,
}: {
  workspace: EditorWorkspace
  owner: EngineOwner
}) {
  const snapshot = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  )
  const tab = snapshot.tabs[0]
  const { host, textarea, phase, compositionStart, compositionEnd } =
    useCodeMirror(owner, tab, false)
  return (
    <div
      onCompositionStart={compositionStart}
      onCompositionEnd={compositionEnd}
    >
      <output>{phase}</output>
      {phase !== 'ready' && (
        <textarea
          aria-label="Code"
          ref={textarea}
          value={tab.document.status === 'ready' ? tab.document.buffer : ''}
          onChange={(event) => tab.session.edit(event.target.value)}
        />
      )}
      <div ref={host} hidden={phase !== 'ready'} />
    </div>
  )
}
function fixture() {
  const services = temporaryWorkspace()
  const workspace = createEditorWorkspace(services.vfs, services.refresh, null)
  workspace.start()
  const tab = workspace.getSnapshot().tabs[0]
  const imported = deferred<EngineModule>()
  const handle: EngineHandle = {
    sync: vi.fn(),
    focus: vi.fn(),
    selection: () => ({ anchor: 2, head: 4 }),
    dispose: vi.fn(),
  }
  const pool: EnginePool = {
    retain: vi.fn(),
    mount: vi.fn(() => handle),
    dispose: vi.fn(),
  }
  const owner = createEngineOwner(() => imported.promise)
  owner.retain([tab.id])
  stops.push(() => {
    owner.dispose()
    workspace.stop()
    services.dispose()
  })
  return { workspace, tab, imported, pool, handle, owner }
}
it('attaches only once under StrictMode with latest draft, selection and focus after loading', async () => {
  const f = fixture()
  const view = render(
    <StrictMode>
      <Harness workspace={f.workspace} owner={f.owner} />
    </StrictMode>,
  )
  const input = screen.getByRole('textbox', {
    name: 'Code',
  }) as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'latest draft' } })
  input.focus()
  input.setSelectionRange(2, 5)
  await act(async () => f.imported.resolve({ createEnginePool: () => f.pool }))
  expect(screen.getByRole('status')).toHaveTextContent('ready')
  expect(f.pool.mount).toHaveBeenCalledTimes(1)
  expect(f.pool.mount).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    f.tab.id,
    expect.objectContaining({ text: 'latest draft' }),
    expect.any(Object),
    { anchor: 2, head: 5 },
  )
  expect(f.handle.focus).toHaveBeenCalledTimes(1)
  act(() => f.tab.session.edit('external replacement'))
  expect(f.handle.sync).toHaveBeenLastCalledWith(
    expect.objectContaining({ text: 'external replacement' }),
  )
  view.unmount()
  expect(f.handle.dispose).toHaveBeenCalledTimes(1)
})
it('defers replacing the native editor while composition is active', async () => {
  const f = fixture()
  render(<Harness workspace={f.workspace} owner={f.owner} />)
  const input = screen.getByRole('textbox', { name: 'Code' })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '日本語' } })
  await act(async () => f.imported.resolve({ createEnginePool: () => f.pool }))
  expect(f.pool.mount).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  await waitFor(() => expect(f.pool.mount).toHaveBeenCalledTimes(1))
  expect(f.pool.mount).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    f.tab.id,
    expect.objectContaining({ text: '日本語' }),
    expect.any(Object),
    undefined,
  )
})
it('keeps latest text and restores selection on adapter failure; stale callbacks cannot edit after cleanup', async () => {
  const f = fixture()
  const view = render(<Harness workspace={f.workspace} owner={f.owner} />)
  await act(async () => f.imported.resolve({ createEnginePool: () => f.pool }))
  const callbacks = vi.mocked(f.pool.mount).mock.calls[0][3]
  act(() => callbacks.edit('kept draft'))
  act(() => callbacks.fail())
  const input = screen.getByRole('textbox', {
    name: 'Code',
  }) as HTMLTextAreaElement
  expect(input).toHaveValue('kept draft')
  expect(input.selectionStart).toBe(2)
  expect(input.selectionEnd).toBe(4)
  expect(f.handle.dispose).toHaveBeenCalledTimes(1)
  view.unmount()
  act(() => callbacks.edit('stale edit'))
  expect(f.tab.session.getSnapshot()).toMatchObject({ buffer: 'kept draft' })
})
it('does not mount after unmount even when a shared lazy owner is still alive', async () => {
  const f = fixture()
  const view = render(<Harness workspace={f.workspace} owner={f.owner} />)
  view.unmount()
  await act(async () => f.imported.resolve({ createEnginePool: () => f.pool }))
  expect(f.pool.mount).not.toHaveBeenCalled()
})
