import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import type { VfsResult } from '../../core/filesystem/types'

it('renames a selected folder by ID, retains input after errors and updates another window cwd', async () => {
  const runtime = createBrowserRuntime()
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
    const selected = await within(frames[1]).findByRole('button', {
      name: 'Select folder Documents',
    })
    await user.click(selected)
    await user.keyboard('{F2}')
    const input = screen.getByRole('textbox', { name: 'Rename Documents' })
    expect(input).toHaveFocus()
    expect((input as HTMLInputElement).selectionEnd).toBe('Documents'.length)
    await user.clear(input)
    await user.type(input, 'Desktop{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(input).toHaveValue('Desktop')
    await user.clear(input)
    await user.type(input, 'bad/name{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'without slashes',
    )
    await user.clear(input)
    await user.type(input, 'Work{Enter}')
    await waitFor(() =>
      expect(
        screen.queryByRole('form', { name: 'Rename item' }),
      ).not.toBeInTheDocument(),
    )
    expect(
      await within(frames[1]).findByRole('button', {
        name: 'Select folder Work',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(
      await within(frames[0]).findByRole('heading', { name: 'Work' }),
    ).toBeInTheDocument()
    expect(
      within(frames[0]).getByRole('button', { name: 'Work' }),
    ).toHaveAttribute('aria-current', 'location')
    await waitFor(() =>
      expect(
        within(frames[1]).getByRole('button', { name: 'Rename' }),
      ).toHaveFocus(),
    )
    const destination = await runtime.vfs.resolve(
      '/home/user/Work',
      ROOT_NODE_ID,
    )
    expect(destination.ok).toBe(true)
    await user.click(within(frames[1]).getByRole('button', { name: 'Rename' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(
      within(frames[1]).getByRole('button', { name: 'Rename' }),
    ).toHaveFocus()
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('renames a file without changing its content/revision and deduplicates pending submissions with retry', async () => {
  const runtime = createBrowserRuntime()
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const created = await runtime.vfs.createFile(home.value, 'before.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: 'Keep me',
  })
  if (!created.ok) throw new Error('Create failed')
  const before = await runtime.vfs.readFile(created.value)
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select file before.txt' }),
    )
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    let finish!: (result: VfsResult<void>) => void
    const original = runtime.vfs.rename
    const rename = vi.spyOn(runtime.vfs, 'rename').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'after.txt{Enter}{Enter}')
    expect(rename).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    await act(async () => {
      finish({
        ok: false,
        error: { code: 'STORAGE_UNAVAILABLE', message: 'raw error' },
      })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Storage is unavailable',
    )
    expect(screen.getByRole('textbox')).toHaveValue('after.txt')
    expect(screen.getByRole('textbox')).not.toHaveAttribute(
      'aria-invalid',
      'true',
    )
    rename.mockImplementation(original)
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(
      await screen.findByRole('button', { name: 'Select file after.txt' }),
    ).toHaveAttribute('aria-pressed', 'true')
    const after = await runtime.vfs.readFile(created.value)
    if (!before.ok || !after.ok) throw new Error('Read failed')
    expect(after.value.content).toEqual(before.value.content)
    expect(after.value.contentRevision).toBe(before.value.contentRevision)
    expect(after.value.node.id).toBe(before.value.node.id)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('reports a removed target without renaming another item', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select folder Documents' }),
    )
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    const id = await runtime.vfs.resolve('/home/user/Documents', ROOT_NODE_ID)
    if (!id.ok) throw new Error('Missing folder')
    await act(async () => {
      await runtime.vfs.remove(id.value, { recursive: false })
    })
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Lost{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no longer available',
    )
    expect(screen.getByRole('textbox')).toHaveValue('Lost')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'user' })).toHaveFocus(),
    )
  } finally {
    view.unmount()
    runtime.dispose()
  }
})

it('does not steal focus after a background rename completes', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await user.click(
      await screen.findByRole('button', { name: 'Select folder Documents' }),
    )
    const original = runtime.vfs.rename
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(runtime.vfs, 'rename').mockImplementation(async (id, name) => {
      await gate
      return original(id, name)
    })
    await user.click(screen.getByRole('button', { name: 'Rename' }))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'Work{Enter}')
    await user.click(
      screen.getByRole('button', { name: 'Open About BrowserOS' }),
    )
    const about = await screen.findByRole('region', {
      name: 'About BrowserOS window',
    })
    about.focus()
    const focusedId = runtime.windows.getState().focusedId
    await act(async () => {
      release()
      await gate
    })
    await screen.findByRole('button', { name: 'Select folder Work' })
    expect(about).toHaveFocus()
    expect(runtime.windows.getState().focusedId).toBe(focusedId)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
