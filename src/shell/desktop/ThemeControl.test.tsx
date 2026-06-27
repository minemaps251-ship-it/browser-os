import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createSettingsService } from '../../core/settings/service'
import { createMemorySettingsRepository } from '../../core/settings/memoryRepository'
import { settingsFailure, type SettingsResult } from '../../core/settings/types'
import { ThemeControl } from './ThemeControl'

it('keeps the selected value while saving and exposes a recoverable error', async () => {
  const repository = createMemorySettingsRepository()
  let complete!: (value: SettingsResult<void>) => void
  vi.spyOn(repository, 'writeTheme').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const settings = createSettingsService(repository)
  const user = userEvent.setup()
  render(<ThemeControl settings={settings} />)
  const select = screen.getByRole('combobox', { name: 'Appearance' })
  await user.selectOptions(select, 'dark')
  expect(select).toBeDisabled()
  expect(select).toHaveValue('system')
  expect(screen.getByRole('status')).toHaveTextContent('Saving')
  await act(async () => {
    complete(settingsFailure('STORAGE_UNAVAILABLE', 'Please retry'))
  })
  expect(select).toBeEnabled()
  expect(select).toHaveValue('system')
  expect(screen.getByRole('alert')).toHaveTextContent('Please retry')
  expect(select).toHaveAccessibleDescription('Please retry')
  await user.selectOptions(select, 'dark')
  expect(select).toHaveValue('dark')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  settings.dispose()
})
