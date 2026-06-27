import { useSyncExternalStore } from 'react'
import { isThemePreference } from '../../core/settings/types'
import type { SettingsService } from '../../core/settings/service'
import styles from './ThemeControl.module.css'
export function ThemeControl({ settings }: { settings: SettingsService }) {
  const snapshot = useSyncExternalStore(
    settings.subscribe,
    settings.getSnapshot,
  )
  return (
    <div className={styles.control}>
      <select
        aria-label="Appearance"
        className={styles.select}
        value={snapshot.theme}
        disabled={snapshot.saving || snapshot.loading}
        aria-describedby={
          snapshot.error || snapshot.warning ? 'appearance-message' : undefined
        }
        onChange={(event) => {
          const value = event.target.value
          if (isThemePreference(value)) void settings.setTheme(value)
        }}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      {snapshot.saving && (
        <span className={styles.message} role="status">
          Saving appearance…
        </span>
      )}
      {(snapshot.error || snapshot.warning) && (
        <p id="appearance-message" className={styles.message} role="alert">
          {snapshot.error ?? snapshot.warning}
        </p>
      )}
    </div>
  )
}
