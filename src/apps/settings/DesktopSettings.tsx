import { useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { defaultPreferences } from '../../core/preferences/service'
import { pinnedApps } from '../../core/preferences/dock'
export function DesktopSettings() {
  const runtime = useRuntime()
  const { value, busy } = useSyncExternalStore(
    runtime.preferences.subscribe,
    runtime.preferences.getSnapshot,
  )
  const pinned = pinnedApps(runtime.registry.list(), value)
  return (
    <section aria-label="Desktop preferences">
      <h2>Desktop & Dock</h2>
      <label>
        Wallpaper{' '}
        <select
          aria-label="Wallpaper"
          disabled={busy}
          value={value.wallpaper}
          onChange={(event) => {
            void runtime.preferences.update({
              wallpaper: event.target.value as 'warm' | 'cool',
            })
          }}
        >
          <option value="warm">Warm dunes</option>
          <option value="cool">Coastal blue</option>
        </select>
      </label>
      <label>
        Shortcut order{' '}
        <select
          aria-label="Shortcut order"
          disabled={busy}
          value={value.shortcutOrder}
          onChange={(event) => {
            void runtime.preferences.update({
              shortcutOrder: event.target.value as 'default' | 'name',
            })
          }}
        >
          <option value="default">Default</option>
          <option value="name">Name</option>
        </select>
      </label>
      <p>
        <label>
          <input
            type="checkbox"
            disabled={busy}
            checked={value.reduceMotion}
            onChange={(event) => {
              void runtime.preferences.update({
                reduceMotion: event.target.checked,
              })
            }}
          />{' '}
          Reduce interface motion
        </label>
      </p>
      <fieldset disabled={busy}>
        <legend>Keep in Dock</legend>
        {runtime.registry.list().map((app) => (
          <label key={app.id} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={pinned.includes(app.id)}
              onChange={(event) => {
                void runtime.preferences.update({
                  pinned: event.target.checked
                    ? [...pinned, app.id]
                    : pinned.filter((id) => id !== app.id),
                })
              }}
            />{' '}
            {app.name}
          </label>
        ))}
      </fieldset>
      <p>
        Drag pinned Dock icons to reorder them, or use their right-click menu.
        Shift+F10 opens this menu with the keyboard.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          void runtime.preferences.update(defaultPreferences)
        }}
      >
        Reset desktop preferences
      </button>
      <p>
        Desktop preferences are stored in this workspace. The current JSON
        export includes saved files and theme; it does not include Dock layout
        or wallpaper.
      </p>
    </section>
  )
}
