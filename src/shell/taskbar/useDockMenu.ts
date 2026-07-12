import {
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type KeyboardEvent,
  type DragEvent,
} from 'react'
import { useRuntime } from '../../app/runtimeContext'
import type { AppId, WindowId } from '../../core/shared/ids'
import { pinnedApps, reorderPinned } from '../../core/preferences/dock'
import type { MenuAnchor, MenuItem } from '../menu/PopupMenu'
import { focusWindowElement } from '../windows/focus'

export function useDockMenu(
  appId: AppId,
  windowId: WindowId | undefined,
  activate: () => void,
) {
  const runtime = useRuntime()
  const preferences = useSyncExternalStore(
    runtime.preferences.subscribe,
    runtime.preferences.getSnapshot,
  )
  const pinned = pinnedApps(runtime.registry.list(), preferences.value)
  const index = pinned.indexOf(appId)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const [dismiss, setDismiss] = useState<() => void>(() => () => {})
  function open(button: HTMLButtonElement, x: number, y: number) {
    setDismiss(() => () => {
      setAnchor(null)
      if (button.isConnected) button.focus()
    })
    setAnchor({ x, y })
  }
  function save(ids: readonly AppId[]) {
    void runtime.preferences.update({ pinned: ids })
  }
  const items: MenuItem[] = [
    {
      id: 'pin',
      label: index < 0 ? 'Keep in Dock' : 'Remove from Dock',
      disabled: preferences.busy,
      run: () =>
        save(
          index < 0 ? [...pinned, appId] : pinned.filter((id) => id !== appId),
        ),
    },
    ...(index >= 0
      ? [
          {
            id: 'left',
            label: 'Move left',
            disabled: preferences.busy || index === 0,
            run: () => save(reorderPinned(pinned, appId, pinned[index - 1])),
          },
          {
            id: 'right',
            label: 'Move right',
            disabled: preferences.busy || index === pinned.length - 1,
            run: () => save(reorderPinned(pinned, appId, pinned[index + 1])),
          },
        ]
      : []),
    {
      id: 'open',
      label: windowId ? 'Show window' : 'Open application',
      run: () => {
        if (windowId) {
          runtime.restoreWindow(windowId)
          focusWindowElement(windowId)
        } else activate()
      },
    },
    ...(windowId
      ? [
          {
            id: 'close',
            label: 'Close window',
            run: () => {
              void runtime.requestCloseWindow(windowId)
            },
          },
        ]
      : []),
  ]
  return {
    pinned: index >= 0,
    anchor,
    dismiss,
    items,
    events: {
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        open(event.currentTarget, event.clientX, event.clientY)
      },
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        if (
          (event.shiftKey && event.key === 'F10') ||
          event.key === 'ContextMenu'
        ) {
          event.preventDefault()
          const rect = event.currentTarget.getBoundingClientRect()
          open(event.currentTarget, rect.left, rect.top)
        }
      },
      draggable: index >= 0 && !preferences.busy,
      onDragStart: (event: DragEvent<HTMLButtonElement>) => {
        event.dataTransfer.setData('application/x-browseros-dock', appId)
        event.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (event: DragEvent<HTMLButtonElement>) => {
        if (
          index >= 0 &&
          event.dataTransfer.types.includes('application/x-browseros-dock')
        ) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        event.preventDefault()
        if (!preferences.busy)
          save(
            reorderPinned(
              pinned,
              event.dataTransfer.getData(
                'application/x-browseros-dock',
              ) as AppId,
              appId,
            ),
          )
      },
    },
  }
}
