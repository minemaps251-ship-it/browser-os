import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import styles from './WindowMenu.module.css'

export function WindowMenu({
  title,
  buttonRef,
  onMove,
}: {
  title: string
  buttonRef: RefObject<HTMLButtonElement | null>
  onMove: () => void
}) {
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const item = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    item.current?.focus()
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
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
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
              item.current?.focus()
            }
          }}
        >
          <button
            ref={item}
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onMove()
            }}
          >
            Move window
          </button>
        </div>
      )}
    </div>
  )
}
