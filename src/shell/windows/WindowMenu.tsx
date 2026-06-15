import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import styles from './WindowMenu.module.css'

export function WindowMenu({
  title,
  buttonRef,
  onMove,
  onResize,
}: {
  title: string
  buttonRef: RefObject<HTMLButtonElement | null>
  onMove: () => void
  onResize: () => void
}) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const initialItem = useRef(0)
  useEffect(() => {
    if (!open) return
    root.current
      ?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
      [initialItem.current]?.focus()
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  return (
    <div
      ref={root}
      className={styles.root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        className={styles.trigger}
        aria-label={`Window actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          initialItem.current = 0
          setOpen(!open)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            initialItem.current = event.key === 'ArrowUp' ? 1 : 0
            setOpen(true)
          }
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          className={styles.menu}
          id={menuId}
          role="menu"
          aria-label={`${title} window actions`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              buttonRef.current?.focus()
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const items = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]',
                ),
              )
              const index = items.findIndex(
                (item) => item === document.activeElement,
              )
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (index +
                        (event.key === 'ArrowUp' ? -1 : 1) +
                        items.length) %
                      items.length
              items[next]?.focus()
            }
          }}
        >
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setOpen(false)
              onMove()
            }}
          >
            Move window
          </button>
          <button
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setOpen(false)
              onResize()
            }}
          >
            Resize window
          </button>
        </div>
      )}
    </div>
  )
}
