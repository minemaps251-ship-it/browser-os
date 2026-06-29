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
