import { expect, it, vi } from 'vitest'
import { bindRefreshVisibility } from './refreshVisibility'
import { createRefreshService } from '../core/refresh/service'
import { createSettingsService } from '../core/settings/service'
import { createMemorySettingsRepository } from '../core/settings/memoryRepository'

it('refreshes only on visibility becoming visible and removes its listener', () => {
  const settings = createSettingsService(createMemorySettingsRepository())
  const refresh = createRefreshService({
    settings,
    validate: async () => ({ ok: true }),
  })
  const request = vi.spyOn(refresh, 'request').mockResolvedValue()
  const surface: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  > = {
    visibilityState: 'hidden',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  const unbind = bindRefreshVisibility(refresh, surface)
  const listener = vi.mocked(surface.addEventListener).mock
    .calls[0][1] as () => void
  listener()
  expect(request).not.toHaveBeenCalled()
  Object.defineProperty(surface, 'visibilityState', { value: 'visible' })
  listener()
  expect(request).toHaveBeenCalledOnce()
  unbind()
  expect(surface.removeEventListener).toHaveBeenCalledWith(
    'visibilitychange',
    listener,
  )
  refresh.dispose()
  settings.dispose()
})
