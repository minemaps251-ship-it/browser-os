import { useSyncExternalStore } from 'react'
import type { SettingsService } from '../core/settings/service'
import type { ThemePreference } from '../core/settings/types'
export function useAppearanceSettings(settings: SettingsService) {
  const snapshot = useSyncExternalStore(
    settings.subscribe,
    settings.getSnapshot,
  )
  return {
    snapshot,
    busy: snapshot.saving || snapshot.loading,
    selectTheme: (theme: ThemePreference) => {
      void settings.setTheme(theme)
    },
    retry: () => {
      const current = settings.getSnapshot()
      if (current.failedTheme && !current.saving && !current.loading)
        void settings.setTheme(current.failedTheme)
    },
  }
}
