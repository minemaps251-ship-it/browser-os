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
import { TransferEntryDialog } from './TransferEntryDialog'
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

it('copies content into another folder with a new identity and moves a folder while another window stays inside it', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const source = await runtime.vfs.createFile(home.value, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Keep this',
  })
  if (!source.ok) throw new Error('Missing source')
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
    await screen.findByText('This folder is empty.')
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const frames = screen.getAllByRole('region', { name: 'Files window' })
    await user.click(
      await within(frames[1]).findByRole('button', {
        name: 'Select file note.txt',
      }),
    )
    await user.click(within(frames[1]).getByRole('button', { name: 'Copy' }))
    const dialog = screen.getByRole('dialog', { name: 'Copy item' })
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Open destination Documents',
      }),
    )
    await user.click(
      await within(dialog).findByRole('button', { name: 'Copy here' }),
    )
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(
      await within(frames[0]).findByRole('button', {
        name: 'Select file note.txt',
      }),
    ).toBeInTheDocument()
    expect(
      within(frames[1]).getByRole('button', { name: 'Select file note.txt' }),
    ).toHaveAttribute('aria-pressed', 'true')
    const copy = await runtime.vfs.resolve(
      '/home/user/Documents/note.txt',
      ROOT_NODE_ID,
    )
    if (!copy.ok) throw new Error('Missing copy')
    expect(copy.value).not.toBe(source.value)
    const document = await runtime.vfs.readFile(copy.value)
    expect(document.ok && document.value.content.text).toBe('Keep this')
    await user.click(
      within(frames[1]).getByRole('button', {
        name: 'Select folder Documents',
      }),
    )
    expect(
      within(frames[1]).getByRole('button', { name: 'Copy' }),
    ).toBeDisabled()
    await user.click(within(frames[1]).getByRole('button', { name: 'Move' }))
    const move = screen.getByRole('dialog', { name: 'Move item' })
    await user.click(
      await within(move).findByRole('button', {
        name: 'Open destination Desktop',
      }),
    )
    await user.click(within(move).getByRole('button', { name: 'Move here' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(
        within(frames[1]).queryByRole('button', {
          name: 'Select folder Documents',
        }),
      ).not.toBeInTheDocument(),
    )
    expect(
      await within(frames[0]).findByRole('button', { name: 'Desktop' }),
    ).toBeInTheDocument()
    const moved = await runtime.vfs.resolve(
      '/home/user/Desktop/Documents/note.txt',
      ROOT_NODE_ID,
    )
    expect(moved).toEqual(copy)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('preserves destination/name on collision and cycle, allows retry and cancels without mutation', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  await runtime.vfs.createFile(home.value, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'text',
  })
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select file note.txt' }),
    )
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    let dialog = screen.getByRole('dialog')
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Copy here' }),
      ).toBeEnabled(),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Copy here' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'already exists',
    )
    const name = within(dialog).getByRole('textbox', {
      name: 'Name at destination',
    })
    expect(name).toHaveValue('note.txt')
    await user.clear(name)
    await user.type(name, 'copy.txt{Enter}')
    await screen.findByRole('button', { name: 'Select file copy.txt' })
    await user.click(
      screen.getByRole('button', { name: 'Select folder Documents' }),
    )
    await user.click(screen.getByRole('button', { name: 'Move' }))
    dialog = screen.getByRole('dialog')
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Open destination Documents',
      }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'cannot be moved into itself',
    )
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move' })).toHaveFocus()
    expect(
      (await runtime.vfs.resolve('/home/user/Documents', ROOT_NODE_ID)).ok,
    ).toBe(true)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('captures the pending destination, blocks navigation/double submit and retains fields after storage failure', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  await runtime.vfs.createFile(home.value, 'source.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select file source.txt' }),
    )
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    const dialog = screen.getByRole('dialog')
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Open destination Documents',
      }),
    )
    let finish!: (result: VfsResult<NodeId>) => void
    const original = runtime.vfs.copyFile
    const copy = vi.spyOn(runtime.vfs, 'copyFile').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Copy here' }))
    fireEvent.submit(within(dialog).getByRole('textbox').closest('form')!)
    expect(copy).toHaveBeenCalledTimes(1)
    expect(within(dialog).getByRole('button', { name: 'Up' })).toBeDisabled()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(dialog).toBeInTheDocument()
    await act(async () => {
      finish({ ok: false, error: { code: 'QUOTA', message: 'raw exception' } })
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'storage is full',
    )
    expect(within(dialog).getByRole('textbox')).toHaveValue('source.txt')
    expect(
      within(dialog).getByRole('heading', { name: 'Documents' }),
    ).toBeInTheDocument()
    copy.mockImplementation(original)
    await user.click(within(dialog).getByRole('button', { name: 'Copy here' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(
      (
        await runtime.vfs.resolve(
          '/home/user/Documents/source.txt',
          ROOT_NODE_ID,
        )
      ).ok,
    ).toBe(true)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('does not silently redirect a copy when the pending destination is removed', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  const documents = await runtime.vfs.resolve(
    '/home/user/Documents',
    ROOT_NODE_ID,
  )
  if (!home.ok || !documents.ok) throw new Error('Missing folder')
  await runtime.vfs.createFile(home.value, 'source.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'text',
  })
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select file source.txt' }),
    )
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    const dialog = screen.getByRole('dialog')
    await user.click(
      await within(dialog).findByRole('button', {
        name: 'Open destination Documents',
      }),
    )
    const original = runtime.vfs.copyFile
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(runtime.vfs, 'copyFile').mockImplementation(
      async (id, destination, name) => {
        await gate
        return original(id, destination, name)
      },
    )
    await user.click(within(dialog).getByRole('button', { name: 'Copy here' }))
    await act(async () => {
      await runtime.vfs.remove(documents.value, { recursive: false })
      release()
      await gate
    })
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'no longer available',
    )
    expect(within(dialog).getByRole('textbox')).toHaveValue('source.txt')
    expect((await runtime.vfs.listDirectory(home.value)).ok).toBe(true)
    expect(
      (
        await runtime.vfs.resolve(
          '/home/user/Documents/source.txt',
          ROOT_NODE_ID,
        )
      ).ok,
    ).toBe(false)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('finishes a pending copy after unmount without calling the closed dialog', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const source = await runtime.vfs.createFile(home.value, 'original.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'text',
  })
  if (!source.ok) throw new Error('Missing source')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const original = runtime.vfs.copyFile
  const copy = vi
    .spyOn(runtime.vfs, 'copyFile')
    .mockImplementation(async (id, destination, name) => {
      await gate
      return original(id, destination, name)
    })
  const completed = vi.fn()
  const view = render(
    <TransferEntryDialog
      target={{ mode: 'copy', id: source.value, name: 'original.txt' }}
      vfs={runtime.vfs}
      refresh={runtime.refresh}
      returnFocus={createRef<HTMLButtonElement>()}
      onCancel={vi.fn()}
      onTransferred={completed}
    />,
  )
  try {
    const user = userEvent.setup()
    await within(screen.getByRole('dialog')).findByRole('button', {
      name: 'Open destination Documents',
    })
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'copy.txt{Enter}')
    view.unmount()
    await act(async () => {
      release()
      await copy.mock.results[0].value
    })
    expect(completed).not.toHaveBeenCalled()
    expect(
      (await runtime.vfs.resolve('/home/user/copy.txt', ROOT_NODE_ID)).ok,
    ).toBe(true)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
