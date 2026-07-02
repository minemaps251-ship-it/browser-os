import { useId } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { useAppearanceSettings } from '../../ui/useAppearanceSettings'
import type { ThemePreference } from '../../core/settings/types'
import styles from './SettingsApp.module.css'
const themes: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]
export default function SettingsApp() {
  const runtime = useRuntime()
  const { snapshot, busy, selectTheme, retry } = useAppearanceSettings(
    runtime.settings,
  )
  const name = useId(),
    description = useId(),
    error = useId()
  return (
    <div className={styles.app}>
      <fieldset
        aria-disabled={busy}
        aria-busy={busy}
        onClickCapture={(event) => {
          if (busy) event.preventDefault()
        }}
        onKeyDown={(event) => {
          if (
            busy &&
            ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(
              event.key,
            )
          )
            event.preventDefault()
        }}
        aria-describedby={`${description}${snapshot.error || snapshot.warning ? ` ${error}` : ''}`}
        className={styles.appearance}
      >
        <legend>Appearance</legend>
        <p id={description} className={styles.help}>
          System follows your device appearance. Changes apply to the whole
          desktop.
        </p>
        <div className={styles.options}>
          {themes.map((theme) => (
            <label key={theme.value} className={styles.option}>
              <input
                type="radio"
                name={name}
                value={theme.value}
                checked={snapshot.theme === theme.value}
                aria-disabled={busy}
                onChange={() => {
                  if (!busy) selectTheme(theme.value)
                }}
              />
              {theme.label}
            </label>
          ))}
        </div>
      </fieldset>
      {snapshot.saving && <p role="status">Saving appearance…</p>}
      {snapshot.loading && <p role="status">Loading appearance…</p>}
      {(snapshot.error || snapshot.warning) && (
        <p id={error} role="alert">
          {snapshot.error ?? snapshot.warning}
        </p>
      )}
      {snapshot.error && snapshot.failedTheme && (
        <button disabled={busy} onClick={retry}>
          Retry appearance
        </button>
      )}
      <section aria-labelledby={`${name}-storage`} className={styles.storage}>
        <h2 id={`${name}-storage`}>Storage</h2>
        <p>
          {runtime.storageMode === 'persistent'
            ? 'Saved in this browser'
            : 'Temporary workspace'}
        </p>
        <p className={styles.help}>
          {runtime.storageMode === 'persistent'
            ? 'Your files and settings stay after a reload. Clearing site data removes them.'
            : 'Your files and settings will be lost when you reload.'}
        </p>
      </section>
    </div>
  )
}
