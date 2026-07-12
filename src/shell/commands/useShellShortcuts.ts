import { useEffect } from 'react'
import { useRuntime } from '../../app/runtimeContext'

export function useShellShortcuts() {
  const runtime = useRuntime()
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.keyCode === 229 ||
        document.querySelector('dialog[open]')
      )
        return
      const state = runtime.windows.getState()
      const owner = state.focusedId && state.byId[state.focusedId]?.processId
      if (!owner) return
      const save =
        !event.altKey &&
        (event.ctrlKey || event.metaKey) &&
        (event.code === 'KeyS' || event.key.toLowerCase() === 's')
      const newDocument =
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.code === 'KeyN' || event.key.toLowerCase() === 'n')
      const shortcut = save
        ? event.shiftKey
          ? 'save-as'
          : 'save'
        : newDocument
          ? 'new'
          : null
      if (!shortcut) return
      const command = runtime.commands
        .list(owner)
        .find((command) => command.shortcut === shortcut)
      if (command) {
        event.preventDefault()
        runtime.commands.execute(owner, command.id)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [runtime])
}
