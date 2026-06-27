import type { SettingsService } from '../core/settings/service'
type ThemeMedia = Pick<
  MediaQueryList,
  'matches' | 'addEventListener' | 'removeEventListener'
>
/** Derive effective appearance without storing OS preferences as user choices. */
export function bindTheme(
  settings: SettingsService,
  root: Pick<HTMLElement, 'dataset'>,
  media?: ThemeMedia,
) {
  const apply = () => {
    const preference = settings.getSnapshot().theme
    root.dataset.theme =
      preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference
  }
  apply()
  const unsubscribe = settings.subscribe(apply)
  media?.addEventListener('change', apply)
  return () => {
    unsubscribe()
    media?.removeEventListener('change', apply)
    root.dataset.theme = media?.matches ? 'dark' : 'light'
  }
}
