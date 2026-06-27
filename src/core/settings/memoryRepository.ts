import {
  isThemePreference,
  settingsFailure,
  type SettingsRepository,
  type ThemePreference,
} from './types'
export function createMemorySettingsRepository(): SettingsRepository {
  let theme: ThemePreference = 'system'
  return {
    readTheme: async () => ({ ok: true, value: theme }),
    writeTheme: async (value) => {
      if (!isThemePreference(value))
        return settingsFailure('INVALID_VALUE', 'Choose a supported theme.')
      theme = value
      return { ok: true, value: undefined }
    },
  }
}
