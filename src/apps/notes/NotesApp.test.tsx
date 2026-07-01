import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'

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
    expect(content).toHaveTextContent('Hello 🌍 <script>unsafe()</script>')
    expect(content.querySelector('script')).toBeNull()
    expect(within(first).queryByRole('textbox')).not.toBeInTheDocument()
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
    expect(
      await within(second).findByText('Second document'),
    ).toBeInTheDocument()
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
    expect(
      within(first).queryByRole('region', { name: 'File contents' }),
    ).not.toBeInTheDocument()
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
