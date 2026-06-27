import { useLayoutEffect } from 'react'
import type { SettingsService } from '../core/settings/service'
import { bindTheme } from './theme'

export function ThemeAppearance({ settings }: { settings: SettingsService }) {
  useLayoutEffect(
    () =>
      bindTheme(
        settings,
        document.documentElement,
        typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-color-scheme: dark)')
          : undefined,
      ),
    [settings],
  )
  return null
}
