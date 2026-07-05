import {
  isThemePreference,
  settingsFailure,
  type SettingsRepository,
  type ThemePreference,
} from './types'
export interface MemorySettingsRepository extends SettingsRepository {
  getCommittedTheme(): ThemePreference
}
export function createMemorySettingsRepository(): MemorySettingsRepository {
  let theme: ThemePreference = 'system'
  return {
    getCommittedTheme: () => theme,
    readTheme: async () => ({ ok: true, value: theme }),
    writeTheme: async (value) => {
      if (!isThemePreference(value))
        return settingsFailure('INVALID_VALUE', 'Choose a supported theme.')
      theme = value
      return { ok: true, value: undefined }
    },
  }
}
