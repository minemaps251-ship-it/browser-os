import {
  useEffect,
  useRef,
  type ReactNode,
  type KeyboardEventHandler,
  type RefObject,
} from 'react'
import styles from './Dialog.module.css'

export function Dialog({
  label,
  children,
  onCancel,
  onKeyDown,
  returnFocus,
  descriptionId,
}: {
  returnFocus: RefObject<HTMLButtonElement | null>
  descriptionId?: string
  label: string
  children: ReactNode
  onCancel: () => void
  onKeyDown?: KeyboardEventHandler<HTMLDialogElement>
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const trigger = returnFocus.current
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus()
    return () => {
      if (dialog?.open) dialog.close()
      trigger?.focus()
    }
  }, [returnFocus])
  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-describedby={descriptionId}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </dialog>
  )
}
