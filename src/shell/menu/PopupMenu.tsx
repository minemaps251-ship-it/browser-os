import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import styles from './PopupMenu.module.css'

export interface MenuItem {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly checked?: boolean
  readonly hint?: string
  readonly run: () => void
}
export interface MenuAnchor {
  readonly x: number
  readonly y: number
}
export function PopupMenu({
  label,
  anchor,
  items,
  onClose,
}: {
  label: string
  anchor: MenuAnchor
  items: readonly MenuItem[]
  onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = menu.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    element.style.left = `${Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8))}px`
    const initial =
      element.querySelector<HTMLElement>('button:not(:disabled)') ?? element
    initial.focus()
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-menu-trigger][aria-expanded="true"]')
      )
        return
      if (event.target instanceof Node && !element?.contains(event.target))
        onClose()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
    // The owner keeps an open menu's anchor and dismiss callback stable.
  }, [anchor, onClose])
  return createPortal(
    <div
      ref={menu}
      tabIndex={-1}
      role="menu"
      aria-label={label}
      className={styles.menu}
      style={{ left: anchor.x, top: anchor.y }}
      onKeyDown={(event) => {
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ),
        ]
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        )
        let next: number | undefined
        if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
        if (event.key === 'ArrowUp')
          next = (index - 1 + buttons.length) % buttons.length
        if (event.key === 'Home') next = 0
        if (event.key === 'End') next = buttons.length - 1
        if (next !== undefined) {
          event.preventDefault()
          buttons[next]?.focus()
        }
        if (['Escape', 'Tab'].includes(event.key)) {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          aria-label={item.label}
          tabIndex={-1}
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.run()
          }}
        >
          <span className={styles.check} aria-hidden="true">
            {item.checked ? '✓' : ''}
          </span>
          <span>{item.label}</span>
          {item.hint && <kbd>{item.hint}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  )
}
export function MenuButton({
  label,
  children,
  items,
  className,
}: {
  label: string
  children?: ReactNode
  items: readonly MenuItem[]
  className?: string
}) {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  // Captured once per opening to avoid refocusing an open menu on unrelated renders.
  const [dismiss, setDismiss] = useState<() => void>(() => () => {})
  function open() {
    if (!trigger.current) return
    const button = trigger.current
    const rect = button.getBoundingClientRect()
    setDismiss(() => () => {
      setAnchor(null)
      if (button.isConnected) button.focus()
    })
    setAnchor({ x: rect.left, y: rect.bottom + 4 })
  }
  return (
    <>
      <button
        ref={trigger}
        data-menu-trigger
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={() => (anchor ? dismiss() : open())}
        onKeyDown={(event) => {
          if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault()
            open()
          }
        }}
      >
        {children ?? label}
      </button>
      {anchor && (
        <PopupMenu
          label={label}
          anchor={anchor}
          items={items}
          onClose={dismiss}
        />
      )}
    </>
  )
}
