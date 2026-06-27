export type ThemePreference = 'system' | 'light' | 'dark'
export type SettingsErrorCode =
  | 'QUOTA'
  | 'INVALID_VALUE'
  | 'CORRUPT_DATA'
  | 'STORAGE_UNAVAILABLE'
  | 'BUSY'
  | 'DISPOSED'
export type SettingsResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: {
        readonly code: SettingsErrorCode
        readonly message: string
      }
    }
export interface SettingsRepository {
  readTheme(): Promise<SettingsResult<ThemePreference>>
  writeTheme(value: ThemePreference): Promise<SettingsResult<void>>
}
export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark'
}
export function settingsFailure(
  code: SettingsErrorCode,
  message: string,
): Extract<SettingsResult<never>, { ok: false }> {
  return { ok: false, error: { code, message } }
}
export function decodeTheme(raw: unknown): SettingsResult<ThemePreference> {
  if (raw === undefined) return { ok: true, value: 'system' }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !('key' in raw) ||
    raw.key !== 'theme' ||
    !('schemaVersion' in raw) ||
    raw.schemaVersion !== 1 ||
    !('value' in raw) ||
    !isThemePreference(raw.value)
  )
    return settingsFailure(
      'CORRUPT_DATA',
      'The saved appearance setting is invalid. System appearance is being used.',
    )
  return { ok: true, value: raw.value }
}
