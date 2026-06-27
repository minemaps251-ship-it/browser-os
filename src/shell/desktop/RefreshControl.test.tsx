import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createRefreshService } from '../../core/refresh/service'
import { createSettingsService } from '../../core/settings/service'
import { createMemorySettingsRepository } from '../../core/settings/memoryRepository'
import type { SettingsResult, ThemePreference } from '../../core/settings/types'
import { RefreshControl } from './RefreshControl'
import { ThemeControl } from './ThemeControl'

it('supports keyboard Refresh, disables the theme during reads, and announces success', async () => {
  const repository = createMemorySettingsRepository()
  let finish!: (result: SettingsResult<ThemePreference>) => void
  vi.spyOn(repository, 'readTheme').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const settings = createSettingsService(repository)
  const refresh = createRefreshService({
    settings,
    validate: async () => ({ ok: true }),
  })
  const request = vi.spyOn(refresh, 'request')
  render(
    <>
      <RefreshControl refresh={refresh} />
      <ThemeControl settings={settings} />
    </>,
  )
  const user = userEvent.setup()
  await user.tab()
  const button = screen.getByRole('button', { name: 'Refresh workspace' })
  expect(button).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(screen.getByRole('status')).toHaveTextContent('Updating workspace')
  await user.keyboard('{Enter}')
  expect(request).toHaveBeenCalledOnce()
  await act(async () => {
    finish({ ok: true, value: 'dark' })
  })
  expect(button).toHaveAttribute('aria-disabled', 'false')
  expect(button).toHaveFocus()
  expect(screen.getByRole('combobox')).toHaveValue('dark')
  expect(screen.getByRole('status')).toHaveTextContent('Workspace updated')
  refresh.dispose()
  settings.dispose()
})

it('shows an update error and permits retry without a false success message', async () => {
  const settings = createSettingsService(createMemorySettingsRepository())
  const validate = vi
    .fn()
    .mockResolvedValueOnce({ ok: false })
    .mockResolvedValue({ ok: true })
  const refresh = createRefreshService({ settings, validate })
  render(<RefreshControl refresh={refresh} />)
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: 'Refresh workspace' })
  await user.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('Please retry')
  expect(screen.queryByText('Workspace updated.')).not.toBeInTheDocument()
  await user.click(button)
  expect(screen.getByRole('status')).toHaveTextContent('Workspace updated')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  refresh.dispose()
  settings.dispose()
})
