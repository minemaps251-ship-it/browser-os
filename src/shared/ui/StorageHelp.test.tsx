import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { StorageHelp } from './StorageHelp'
it('keeps storage help keyboard focusable and explains limits and temporary mode', async () => {
  render(<StorageHelp />)
  const user = userEvent.setup()
  await user.tab()
  const summary = screen.getByText('Storage and recovery')
  expect(summary).toHaveFocus()
  await user.click(summary)
  expect(summary.closest('details')).toHaveAttribute('open')
  expect(screen.getByText(/1 MiB of text per file/)).toBeInTheDocument()
  expect(screen.getByText(/10 MiB of text across/)).toBeInTheDocument()
  expect(screen.getByText(/2,000 files and folders/)).toBeInTheDocument()
  expect(
    screen.getByText(/Browser storage is not a backup/),
  ).toBeInTheDocument()
  expect(screen.getByText(/does not replace or repair/)).toBeInTheDocument()
})
