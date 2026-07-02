import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, it } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
it('supports commands, IME-safe Enter, independent windows and sees Files/VFS changes', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await user.click(screen.getByRole('button', { name: 'Open Terminal' }))
    const first = await screen.findByRole('region', { name: 'Terminal window' })
    const input = within(first).getByRole('textbox', { name: 'Command' })
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    fireEvent.compositionStart(input)
    await user.type(input, 'pwd{Enter}')
    expect(within(first).getByRole('log')).not.toHaveTextContent('$ pwd')
    fireEvent.compositionEnd(input)
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(within(first).getByRole('log')).toHaveTextContent('/home/user'),
    )
    await user.type(input, 'cd Documents{Enter}')
    await waitFor(() =>
      expect(
        within(first).getByText('/home/user/Documents'),
      ).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: 'Open Terminal' }))
    const second = screen.getAllByRole('region', { name: 'Terminal window' })[1]
    expect(await within(second).findByText('/home/user')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const files = await screen.findByRole('region', { name: 'Files window' })
    await user.click(
      await within(files).findByRole('button', {
        name: 'Select folder Documents',
      }),
    )
    await user.click(within(files).getByRole('button', { name: 'Rename' }))
    await user.clear(within(files).getByRole('textbox'))
    await user.type(within(files).getByRole('textbox'), 'Work{Enter}')
    expect(
      await within(first).findByText('/home/user/Work'),
    ).toBeInTheDocument()
    await user.type(within(second).getByRole('textbox'), 'ls{Enter}')
    await waitFor(() =>
      expect(within(second).getByRole('log')).toHaveTextContent('Work/'),
    )
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})

it('recalls submitted errors and clear, preserves draft edits, and keeps windows independent', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    await user.click(screen.getByRole('button', { name: 'Open Terminal' }))
    const first = await screen.findByRole('region', { name: 'Terminal window' })
    const input = within(first).getByRole('textbox', { name: 'Command' })
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    await user.type(input, 'missing-command{Enter}')
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    expect(within(first).getByRole('log')).toHaveTextContent(
      'command not found',
    )
    await user.type(input, 'clear{Enter}')
    await waitFor(() =>
      expect(within(first).getByRole('log')).toBeEmptyDOMElement(),
    )
    await user.type(input, 'echo draft')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveValue('clear')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveValue('missing-command')
    expect(within(first).getByRole('log')).toBeEmptyDOMElement()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveValue('echo draft')
    await user.keyboard('{ArrowUp}')
    await user.clear(input)
    await user.type(input, 'echo edited')
    await user.keyboard('{ArrowUp}{ArrowDown}')
    expect(input).toHaveValue('echo edited')
    await user.click(screen.getByRole('button', { name: 'Open Terminal' }))
    const second = screen.getAllByRole('region', { name: 'Terminal window' })[1]
    const other = within(second).getByRole('textbox', { name: 'Command' })
    await waitFor(() => expect(other).not.toHaveAttribute('readonly'))
    await user.type(other, 'second draft{ArrowUp}')
    expect(other).toHaveValue('second draft')
    expect(input).toHaveValue('echo edited')
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})

it('clears output with Ctrl+L without clearing draft/history or interrupting IME', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Terminal' }))
    const frame = await screen.findByRole('region', { name: 'Terminal window' })
    const input = within(frame).getByRole('textbox', { name: 'Command' })
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    await user.type(input, 'echo first{Enter}')
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    await user.type(input, 'echo draft')
    await user.keyboard('{Control>}l{/Control}')
    await waitFor(() =>
      expect(within(frame).getByRole('log')).toBeEmptyDOMElement(),
    )
    expect(input).toHaveValue('echo draft')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveValue('echo first')
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveValue('echo draft')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(input).not.toHaveAttribute('readonly'))
    fireEvent.compositionStart(input)
    await user.keyboard('{Control>}l{/Control}')
    expect(within(frame).getByRole('log')).toHaveTextContent('$ echo draft')
    fireEvent.compositionEnd(input)
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})
