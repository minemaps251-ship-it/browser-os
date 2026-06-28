import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
it('supports keyboard folder navigation, two independent windows and local VFS updates', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const first = await screen.findByRole('region', { name: 'Files window' })
    const documents = await within(first).findByRole('button', {
      name: 'Open folder Documents',
    })
    documents.focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(
        within(first).getByRole('heading', { name: 'Documents' }),
      ).toHaveFocus(),
    )
    expect(within(first).getByText('This folder is empty.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    await waitFor(() =>
      expect(
        screen.getAllByRole('region', { name: 'Files window' }),
      ).toHaveLength(2),
    )
    const second = screen.getAllByRole('region', { name: 'Files window' })[1]
    expect(
      await within(second).findByRole('button', {
        name: 'Open folder Documents',
      }),
    ).toBeInTheDocument()
    expect(
      within(first).getByRole('heading', { name: 'Documents' }),
    ).toBeInTheDocument()
    const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
    if (!home.ok) throw new Error(home.error.message)
    await act(async () => {
      await runtime.vfs.createFile(home.value, 'hello.txt', {
        kind: 'text',
        encoding: 'utf-8',
        text: 'hello',
      })
    })
    const file = await within(second).findByRole('button', {
      name: 'Select file hello.txt',
    })
    await user.click(file)
    expect(file).toHaveAttribute('aria-pressed', 'true')
    expect(
      within(second).getByText(/File opening will be available/),
    ).toBeInTheDocument()
    expect(
      within(first).queryByRole('button', { name: 'Select file hello.txt' }),
    ).not.toBeInTheDocument()
  } finally {
    act(() => runtime.dispose())
  }
})

it('does not steal focus when folder loading finishes in a background window', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const files = await screen.findByRole('region', { name: 'Files window' })
    const documents = await within(files).findByRole('button', {
      name: 'Open folder Documents',
    })
    const original = runtime.vfs.listDirectory
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(runtime.vfs, 'listDirectory').mockImplementation(async (id) => {
      await pending
      return original(id)
    })
    await user.click(documents)
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
      await pending
    })
    await within(files).findByRole('heading', { name: 'Documents' })
    expect(about).toHaveFocus()
    expect(runtime.windows.getState().focusedId).toBe(focusedId)
  } finally {
    act(() => runtime.dispose())
  }
})
