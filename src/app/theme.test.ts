import { expect, it, vi } from 'vitest'
import { bindTheme } from './theme'
import { createSettingsService } from '../core/settings/service'
import { createMemorySettingsRepository } from '../core/settings/memoryRepository'

it('tracks the OS only for system appearance and releases both subscriptions', async () => {
  const settings = createSettingsService(createMemorySettingsRepository())
  const root: Pick<HTMLElement, 'dataset'> = { dataset: {} }
  const media = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const release = bindTheme(settings, root, media)
  const change = media.addEventListener.mock.calls[0][1] as () => void
  expect(root.dataset.theme).toBe('light')
  media.matches = true
  change()
  expect(root.dataset.theme).toBe('dark')
  await settings.setTheme('light')
  change()
  expect(root.dataset.theme).toBe('light')
  await settings.setTheme('system')
  expect(root.dataset.theme).toBe('dark')
  release()
  expect(media.removeEventListener).toHaveBeenCalledWith('change', change)
  await settings.setTheme('light')
  expect(root.dataset.theme).toBe('dark')
  settings.dispose()
})
