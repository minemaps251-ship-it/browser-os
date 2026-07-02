import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { temporaryWorkspace } from '../../app/workspace'
import { createSettingsService } from '../../core/settings/service'
import { createMemorySettingsRepository } from '../../core/settings/memoryRepository'
import { settingsFailure, type SettingsResult } from '../../core/settings/types'
import { deferred } from '../../test/fixtures'

it('shares committed appearance with shell, restores singleton and reports temporary storage', async () => {
  const runtime = createBrowserRuntime()
  const user = userEvent.setup()
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    const launcher = screen.getByRole('button', { name: 'Open Settings' })
    await user.click(launcher)
    const frame = await screen.findByRole('region', { name: 'Settings window' })
    expect(within(frame).getByText('Temporary workspace')).toBeInTheDocument()
    await user.click(within(frame).getByRole('radio', { name: 'Dark' }))
    await waitFor(() =>
      expect(within(frame).getByRole('radio', { name: 'Dark' })).toBeChecked(),
    )
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toHaveValue(
      'dark',
    )
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Appearance' }),
      'light',
    )
    expect(within(frame).getByRole('radio', { name: 'Light' })).toBeChecked()
    await user.click(
      within(frame).getByRole('button', { name: 'Minimize Settings' }),
    )
    await user.click(launcher)
    expect(
      screen.getAllByRole('region', { name: 'Settings window' }),
    ).toHaveLength(1)
    expect(frame).not.toHaveAttribute('hidden')
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})
it('keeps committed radio while pending and retries the actual failed target after reopen', async () => {
  const workspace = temporaryWorkspace()
  const repository = createMemorySettingsRepository()
  const gate = deferred<SettingsResult<void>>()
  const write = vi
    .spyOn(repository, 'writeTheme')
    .mockImplementationOnce(() => gate.promise)
  const settings = createSettingsService(repository)
  const runtime = createBrowserRuntime(undefined, {
    ...workspace,
    settings,
    dispose: () => {
      settings.dispose()
      workspace.dispose()
    },
  })
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Settings' }))
    let frame = await screen.findByRole('region', { name: 'Settings window' })
    await user.click(within(frame).getByRole('radio', { name: 'Dark' }))
    expect(within(frame).getByRole('radio', { name: 'System' })).toBeChecked()
    expect(within(frame).getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(within(frame).getByRole('radio', { name: 'Dark' })).toHaveFocus()
    await user.click(within(frame).getByRole('radio', { name: 'Light' }))
    expect(write).toHaveBeenCalledOnce()
    expect(within(frame).getByRole('radio', { name: 'System' })).toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Appearance' })).toBeDisabled()
    await act(async () => {
      gate.resolve(settingsFailure('QUOTA', 'Storage is full. Please retry.'))
    })
    expect(within(frame).getByRole('alert')).toHaveTextContent('full')
    await user.click(
      within(frame).getByRole('button', { name: 'Close Settings' }),
    )
    await user.click(screen.getByRole('button', { name: 'Open Settings' }))
    frame = await screen.findByRole('region', { name: 'Settings window' })
    await user.click(
      within(frame).getByRole('button', { name: 'Retry appearance' }),
    )
    await waitFor(() =>
      expect(within(frame).getByRole('radio', { name: 'Dark' })).toBeChecked(),
    )
    expect(write).toHaveBeenNthCalledWith(2, 'dark')
    expect(within(frame).queryByRole('alert')).not.toBeInTheDocument()
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})
