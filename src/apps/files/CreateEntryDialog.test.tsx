import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, createRef } from 'react'
import { CreateEntryDialog } from './CreateEntryDialog'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import type { VfsResult, NodeId } from '../../core/filesystem/types'

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

it('creates folders and empty files, selects after commit, updates another window and keeps names on validation errors', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await screen.findByRole('button', { name: 'Open folder Documents' })
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const frames = screen.getAllByRole('region', { name: 'Files window' })
    await within(frames[1]).findByRole('button', {
      name: 'Open folder Documents',
    })
    const trigger = within(frames[1]).getByRole('button', {
      name: 'New folder',
    })
    await user.click(trigger)
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus()
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Documents')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('textbox')).toHaveValue('Documents')
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'bad/name')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'without slashes',
    )
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Projects{Enter}')
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(trigger).toHaveFocus()
    expect(
      await within(frames[1]).findByRole('button', {
        name: 'Open folder Projects',
      }),
    ).toHaveAttribute('data-selected', 'true')
    expect(
      await within(frames[0]).findByRole('button', {
        name: 'Open folder Projects',
      }),
    ).toBeInTheDocument()
    await user.click(
      within(frames[1]).getByRole('button', { name: 'New file' }),
    )
    await user.type(screen.getByRole('textbox'), 'note.txt{Enter}')
    const file = await within(frames[1]).findByRole('button', {
      name: 'Select file note.txt',
    })
    expect(file).toHaveAttribute('aria-pressed', 'true')
    const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
    if (!home.ok) throw new Error('Missing home')
    const id = await runtime.vfs.resolve('note.txt', home.value)
    if (!id.ok) throw new Error('Missing file')
    const document = await runtime.vfs.readFile(id.value)
    expect(document.ok && document.value.content.text).toBe('')
    await user.click(
      within(frames[1]).getByRole('button', { name: 'New file' }),
    )
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      within(frames[1]).getByRole('button', { name: 'New file' }),
    ).toHaveFocus()
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('blocks duplicate submit and cancellation while pending, preserves input on quota failure and allows retry', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await screen.findByRole('button', { name: 'Open folder Documents' })
    let finish!: (result: VfsResult<NodeId>) => void
    const original = runtime.vfs.createFile
    const create = vi.spyOn(runtime.vfs, 'createFile').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await user.click(screen.getByRole('button', { name: 'New file' }))
    await user.type(screen.getByRole('textbox'), 'pending.txt{Enter}{Enter}')
    expect(create).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent(
      screen.getByRole('dialog'),
      new Event('cancel', { cancelable: true }),
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await act(async () => {
      finish({ ok: false, error: { code: 'QUOTA', message: 'raw exception' } })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Browser storage is full',
    )
    expect(screen.getByRole('textbox')).toHaveValue('pending.txt')
    expect(screen.queryByText('raw exception')).not.toBeInTheDocument()
    create.mockImplementation(original)
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(
      await screen.findByRole('button', { name: 'Select file pending.txt' }),
    ).toHaveAttribute('aria-pressed', 'true')
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('keeps the captured destination when it is removed and does not create in the fallback folder', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Open folder Documents' }),
    )
    await screen.findByText('This folder is empty.')
    await user.click(screen.getByRole('button', { name: 'New file' }))
    await user.type(screen.getByRole('textbox'), 'lost.txt')
    const destination = await runtime.vfs.resolve(
      '/home/user/Documents',
      ROOT_NODE_ID,
    )
    if (!destination.ok) throw new Error('Missing folder')
    await act(async () => {
      await runtime.vfs.remove(destination.value, { recursive: false })
    })
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'destination folder is no longer available',
    )
    expect(screen.getByRole('textbox')).toHaveValue('lost.txt')
    expect(
      await runtime.vfs.resolve('/home/user/lost.txt', ROOT_NODE_ID),
    ).toMatchObject({ ok: false })
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('does not call a closed dialog back when a pending commit finishes', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const original = runtime.vfs.createDirectory
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const operation = vi.fn(async (parent: NodeId, name: string) => {
    await gate
    return original(parent, name)
  })
  const onCreated = vi.fn()
  const view = render(
    <CreateEntryDialog
      destination={{
        kind: 'directory',
        parentId: home.value,
        parentName: 'user',
      }}
      vfs={{ createDirectory: operation, createFile: runtime.vfs.createFile }}
      returnFocus={createRef<HTMLButtonElement>()}
      onCreated={onCreated}
      onCancel={vi.fn()}
    />,
  )
  try {
    const user = userEvent.setup()
    await user.type(screen.getByRole('textbox'), 'Committed{Enter}')
    view.unmount()
    await act(async () => {
      release()
      await operation.mock.results[0].value
    })
    expect(onCreated).not.toHaveBeenCalled()
    expect(
      await runtime.vfs.resolve('/home/user/Committed', ROOT_NODE_ID),
    ).toMatchObject({ ok: true })
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
