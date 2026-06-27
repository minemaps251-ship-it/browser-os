import type { RefreshService } from '../core/refresh/service'
export function bindRefreshVisibility(
  refresh: RefreshService,
  surface: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  >,
) {
  const onVisibility = () => {
    if (surface.visibilityState === 'visible') void refresh.request()
  }
  surface.addEventListener('visibilitychange', onVisibility)
  return () => surface.removeEventListener('visibilitychange', onVisibility)
}
