import {
  act,
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'

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
it('opens two real text files, deduplicates windows, renders HTML literally and follows deletion', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const one = await runtime.vfs.createFile(home.value, 'one.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Hello 🌍 <script>unsafe()</script>',
  })
  const two = await runtime.vfs.createFile(home.value, 'two.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Second document',
  })
  if (!one.ok || !two.ok) throw new Error('Missing files')
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await act(async () => {
      await runtime.openFile(one.value)
    })
    const first = await screen.findByRole('region', { name: 'Notes window' })
    const content = await within(first).findByRole('region', {
      name: 'File contents',
    })
    expect(within(content).getByRole('textbox')).toHaveValue(
      'Hello 🌍 <script>unsafe()</script>',
    )
    expect(content.querySelector('script')).toBeNull()
    expect(within(first).getByRole('textbox')).toBeEnabled()
    await act(async () => {
      await runtime.openFile(one.value)
    })
    expect(
      screen.getAllByRole('region', { name: 'Notes window' }),
    ).toHaveLength(1)
    await act(async () => {
      await runtime.openFile(two.value)
    })
    const second = screen.getAllByRole('region', { name: 'Notes window' })[1]
    expect(await within(second).findByRole('textbox')).toHaveValue(
      'Second document',
    )
    await act(async () => {
      await runtime.vfs.rename(one.value, 'renamed.txt')
    })
    expect(
      await within(first).findByRole('heading', { name: 'renamed.txt' }),
    ).toBeInTheDocument()
    await act(async () => {
      await runtime.vfs.remove(one.value, { recursive: false })
    })
    expect(await within(first).findByRole('alert')).toHaveTextContent('removed')
    expect(within(first).getByRole('textbox')).toHaveValue(
      'Hello 🌍 <script>unsafe()</script>',
    )
    await user.click(within(first).getByRole('button', { name: 'Retry file' }))
    expect(await within(first).findByRole('alert')).toHaveTextContent('removed')
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})
it('shows launcher guidance and retries a failed document read through the hook', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const file = await runtime.vfs.createFile(home.value, 'empty.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!file.ok) throw new Error('Missing file')
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Notes' }))
    expect(
      await screen.findByText(
        'Open a text file from Files to read it in Notes.',
      ),
    ).toBeInTheDocument()
    vi.spyOn(runtime.vfs, 'readFile').mockResolvedValueOnce({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', message: 'unavailable' },
    })
    await act(async () => {
      await runtime.openFile(file.value)
    })
    const frames = screen.getAllByRole('region', { name: 'Notes window' })
    const frame = frames[1]
    await waitFor(() =>
      expect(within(frame).getByRole('alert')).toHaveTextContent('Retry'),
    )
    await user.click(within(frame).getByRole('button', { name: 'Retry file' }))
    expect(
      await within(frame).findByText('This file is empty.'),
    ).toBeInTheDocument()
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})

it('saves with keyboard outside IME, warns on unload, and supports Cancel, Save and Discard close', async () => {
  const runtime = createBrowserRuntime()
  const file = await runtime.vfs.createFile(ROOT_NODE_ID, 'edit.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Original',
  })
  if (!file.ok) throw new Error('Missing file')
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await act(async () => {
      await runtime.openFile(file.value)
    })
    let frame = await screen.findByRole('region', { name: 'Notes window' })
    let input = await within(frame).findByRole('textbox', { name: 'Text' })
    await user.clear(input)
    await user.type(input, 'Saved text')
    const warning = new Event('beforeunload', { cancelable: true })
    fireEvent(window, warning)
    expect(warning.defaultPrevented).toBe(true)
    const write = vi.spyOn(runtime.vfs, 'writeFile')
    fireEvent.compositionStart(input)
    await user.keyboard('{Control>}s{/Control}')
    expect(write).not.toHaveBeenCalled()
    fireEvent.compositionEnd(input)
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() =>
      expect(
        within(frame).getByRole('button', { name: /^Save$/ }),
      ).toBeDisabled(),
    )
    expect(await runtime.vfs.readFile(file.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Saved text' } },
    })
    await user.type(input, ' changed')
    await user.click(within(frame).getByRole('button', { name: 'Close Notes' }))
    let dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(input).toHaveValue('Saved text changed')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(within(frame).getByRole('button', { name: 'Close Notes' }))
    dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Save and close' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Notes window' }),
      ).not.toBeInTheDocument(),
    )
    expect(await runtime.vfs.readFile(file.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Saved text changed' } },
    })
    await act(async () => {
      await runtime.openFile(file.value)
    })
    frame = await screen.findByRole('region', { name: 'Notes window' })
    input = await within(frame).findByRole('textbox')
    await user.type(input, ' discarded')
    await user.click(within(frame).getByRole('button', { name: 'Close Notes' }))
    dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    await user.click(
      within(dialog).getByRole('button', { name: 'Discard changes' }),
    )
    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Notes window' }),
      ).not.toBeInTheDocument(),
    )
    expect(await runtime.vfs.readFile(file.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'Saved text changed' } },
    })
    const cleanWarning = new Event('beforeunload', { cancelable: true })
    fireEvent(window, cleanWarning)
    expect(cleanWarning.defaultPrevented).toBe(false)
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})
