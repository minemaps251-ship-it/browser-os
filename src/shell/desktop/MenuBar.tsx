import { useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from 'zustand'
import { useRuntime } from '../../app/runtimeContext'
import { MenuButton, type MenuItem } from '../menu/PopupMenu'
import { Dialog } from '../../ui/Dialog'
import { focusWindowElement } from '../windows/focus'
import type { AppId } from '../../core/shared/ids'
import styles from './MenuBar.module.css'

export function MenuBar() {
  const runtime = useRuntime()
  const focused = useStore(runtime.windows, (state) => state.focusedId)
  return <ActiveMenuBar key={focused ?? 'desktop'} />
}
function ActiveMenuBar() {
  const runtime = useRuntime()
  const id = useStore(runtime.windows, (state) => state.focusedId)
  const owner = useStore(runtime.windows, (state) =>
    id ? (state.byId[id]?.processId ?? null) : null,
  )
  const title = useStore(runtime.windows, (state) =>
    id ? (state.byId[id]?.title ?? 'Desktop') : 'Desktop',
  )
  const placed = useStore(runtime.windows, (state) =>
    id ? state.byId[id]?.placement.kind !== 'normal' : false,
  )
  const commands = useSyncExternalStore(runtime.commands.subscribe, () =>
    runtime.commands.list(owner),
  )
  const helpButton = useRef<HTMLButtonElement>(null)
  const [help, setHelp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function launch(app: string) {
    const result = await runtime.launch(app as AppId)
    if (result.ok) focusWindowElement(result.windowId)
    else setError(result.message)
  }
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'
  const system: MenuItem[] = [
    {
      id: 'about',
      label: 'About BrowserOS',
      run: () => {
        void launch('about')
      },
    },
    {
      id: 'settings',
      label: 'System Settings…',
      run: () => {
        void launch('settings')
      },
    },
    {
      id: 'refresh',
      label: 'Refresh workspace',
      run: () => {
        void runtime.refresh.request()
      },
    },
  ]
  const windowItems: MenuItem[] = id
    ? [
        {
          id: 'minimize',
          label: 'Minimize window',
          run: () => runtime.minimizeWindow(id),
        },
        {
          id: 'fill',
          label: placed ? 'Restore window size' : 'Fill workspace',
          run: () =>
            placed
              ? runtime.restoreWindowBounds(id)
              : runtime.maximizeWindow(id),
        },
        {
          id: 'close',
          label: 'Close window',
          run: () => {
            void runtime.requestCloseWindow(id)
          },
        },
      ]
    : []
  return (
    <>
      <nav aria-label="Desktop menu bar" className={styles.bar}>
        <h1 aria-label="BrowserOS">
          <MenuButton
            label="BrowserOS menu"
            className={styles.system}
            items={system.filter(
              (item) =>
                item.id === 'refresh' || runtime.registry.get(item.id as AppId),
            )}
          >
            <span aria-hidden="true">▦</span>
            <span className={styles.name}>BrowserOS</span>
          </MenuButton>
        </h1>
        <span className={styles.active} aria-label="Active application">
          {title}
        </span>
        {(['File', 'Edit', 'View'] as const).map((group) => {
          const items = commands
            .filter((command) => command.group === group)
            .map((command) => ({
              id: command.id,
              label: command.label,
              disabled: !command.enabled,
              hint:
                command.shortcut === 'save'
                  ? `${modifier}S`
                  : command.shortcut === 'save-as'
                    ? `${modifier}Shift+S`
                    : command.shortcut === 'new'
                      ? 'Ctrl+Alt+N'
                      : undefined,
              run: () => {
                if (owner) {
                  if (id) focusWindowElement(id)
                  runtime.commands.execute(owner, command.id)
                }
              },
            }))
          return items.length ? (
            <MenuButton key={group} label={`${group} menu`} items={items}>
              {group}
            </MenuButton>
          ) : null
        })}
        {id && (
          <MenuButton label="Window menu" items={windowItems}>
            Window
          </MenuButton>
        )}
        <button ref={helpButton} onClick={() => setHelp(true)}>
          Help
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {help && (
        <Dialog
          label="Keyboard shortcuts"
          returnFocus={helpButton}
          onCancel={() => setHelp(false)}
        >
          <h2>Keyboard shortcuts</h2>
          <p>Use the application menus to discover available actions.</p>
          <dl>
            <dt>⌘ / Ctrl + S</dt>
            <dd>Save the active document</dd>
            <dt>⌘ / Ctrl + Shift + S</dt>
            <dd>Save as</dd>
            <dt>Ctrl + Alt + N</dt>
            <dd>New document or editor tab</dd>
            <dt>Ctrl + Alt + M / R</dt>
            <dd>Move / resize the active window with arrow keys</dd>
            <dt>Escape</dt>
            <dd>Dismiss a menu or cancel a window gesture</dd>
          </dl>
          <p>
            Drag a title bar to move a window. Drag to desktop edges or corners
            to tile it. Double-click a title bar to fill or restore the
            workspace.
          </p>
          <p>
            Right-click a Dock icon to pin, unpin or reorder it. Shift+F10 opens
            its menu from the keyboard. Browser and operating-system shortcuts
            may take priority.
          </p>
          <button data-dialog-initial-focus onClick={() => setHelp(false)}>
            Done
          </button>
        </Dialog>
      )}
    </>
  )
}
