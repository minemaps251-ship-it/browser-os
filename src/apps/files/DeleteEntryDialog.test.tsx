import {
  act,
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, createRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import type { VfsResult } from '../../core/filesystem/types'
import { DeleteEntryDialog } from './DeleteEntryDialog'
let restoreDialogs: () => void
beforeEach(() => {
  const prototype = HTMLDialogElement.prototype
  const saved = Object.getOwnPropertyDescriptors(prototype)
  Object.defineProperty(prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
  restoreDialogs = () => {
    for (const name of ['showModal', 'close']) {
      if (saved[name]) Object.defineProperty(prototype, name, saved[name])
      else Reflect.deleteProperty(prototype, name)
    }
  }
})
afterEach(() => restoreDialogs())

it('cancels safely, requires recursive consent, deletes descendants and returns another window from removed cwd', async () => {
  const runtime = createBrowserRuntime()
  const folder = await runtime.vfs.resolve('/home/user/Documents', ROOT_NODE_ID)
  if (!folder.ok) throw new Error('Missing folder')
  const child = await runtime.vfs.createFile(folder.value, 'nested.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'saved',
  })
  if (!child.ok) throw new Error('Missing child')
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Open folder Documents' }),
    )
    await screen.findByRole('button', { name: 'Select file nested.txt' })
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const frames = screen.getAllByRole('region', { name: 'Files window' })
    await user.click(
      await within(frames[1]).findByRole('button', {
        name: 'Select folder Documents',
      }),
    )
    const trigger = within(frames[1]).getByRole('button', { name: 'Delete' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect((await runtime.vfs.stat(folder.value)).ok).toBe(true)
    await user.click(trigger)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not empty')
    expect((await runtime.vfs.stat(child.value)).ok).toBe(true)
    await user.click(checkbox)
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect((await runtime.vfs.stat(folder.value)).ok).toBe(false)
    expect((await runtime.vfs.stat(child.value)).ok).toBe(false)
    expect(
      await within(frames[0]).findByRole('heading', { name: 'user' }),
    ).toBeInTheDocument()
    expect(
      within(frames[0]).getByText(/previous folder was removed/),
    ).toBeInTheDocument()
    expect(trigger).toBeDisabled()
    await waitFor(() =>
      expect(
        within(frames[1]).getByRole('heading', { name: 'user' }),
      ).toHaveFocus(),
    )
    expect(
      within(frames[1]).getByText('“Documents” has been deleted.'),
    ).toBeInTheDocument()
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('deduplicates deletion, retains selection on storage failure and allows retry', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const file = await runtime.vfs.createFile(home.value, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'hello',
  })
  if (!file.ok) throw new Error('Missing file')
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select file note.txt' }),
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const original = runtime.vfs.remove
    let finish!: (result: VfsResult<void>) => void
    const remove = vi.spyOn(runtime.vfs, 'remove').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(file.value, { recursive: false })
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => {
      finish({
        ok: false,
        error: { code: 'STORAGE_UNAVAILABLE', message: 'private exception' },
      })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Storage is unavailable',
    )
    expect(
      screen.getByRole('button', { name: 'Select file note.txt' }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect((await runtime.vfs.readFile(file.value)).ok).toBe(true)
    remove.mockImplementation(original)
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect((await runtime.vfs.stat(file.value)).ok).toBe(false)
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('reports an already removed item without success and clears stale selection on explicit close', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select folder Documents' }),
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    const folder = await runtime.vfs.resolve(
      '/home/user/Documents',
      ROOT_NODE_ID,
    )
    if (!folder.ok) throw new Error('Missing folder')
    await act(async () => {
      await runtime.vfs.remove(folder.value, { recursive: false })
    })
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already been removed',
    )
    expect(
      screen.getByRole('button', { name: 'Delete permanently' }),
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(
      screen.queryByText('“Documents” has been deleted.'),
    ).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'user' })).toHaveFocus(),
    )
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('allows a pending commit to finish after unmount without calling the closed dialog', async () => {
  const runtime = createBrowserRuntime()
  const id = await runtime.vfs.resolve('/home/user/Documents', ROOT_NODE_ID)
  if (!id.ok) throw new Error('Missing folder')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const remove = vi.fn(async () => {
    await gate
    return runtime.vfs.remove(id.value, { recursive: false })
  })
  const onDeleted = vi.fn()
  const view = render(
    <DeleteEntryDialog
      target={{ id: id.value, name: 'Documents', kind: 'directory' }}
      vfs={{ remove }}
      returnFocus={createRef<HTMLButtonElement>()}
      onCancel={vi.fn()}
      onMissing={vi.fn()}
      onDeleted={onDeleted}
    />,
  )
  try {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Delete permanently' }))
    view.unmount()
    await act(async () => {
      release()
      await remove.mock.results[0].value
    })
    expect(onDeleted).not.toHaveBeenCalled()
    expect((await runtime.vfs.stat(id.value)).ok).toBe(false)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
