import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Dialog } from '../../ui/Dialog'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { NodeId } from '../../core/filesystem/types'
import { deleteErrorMessage } from './deleteError'
import styles from './DeleteEntryDialog.module.css'

export interface DeleteTarget {
  readonly id: NodeId
  readonly name: string
  readonly kind: 'directory' | 'file'
}

export function DeleteEntryDialog({
  target,
  vfs,
  returnFocus,
  onCancel,
  onDeleted,
  onMissing,
}: {
  target: DeleteTarget
  vfs: Pick<VirtualFileSystem, 'remove'>
  returnFocus: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onDeleted: () => void
  onMissing: () => void
}) {
  const [recursive, setRecursive] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const descriptionId = useId()
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function submit() {
    if (submitting.current || missing) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const result = await vfs.remove(target.id, {
        recursive: target.kind === 'directory' && recursive,
      })
      if (!mounted.current) return
      if (result.ok) onDeleted()
      else {
        setError(deleteErrorMessage(result.error.code))
        if (result.error.code === 'NOT_FOUND') setMissing(true)
      }
    } catch {
      if (mounted.current)
        setError('The item could not be deleted. Please try again.')
    } finally {
      submitting.current = false
      if (mounted.current) setPending(false)
    }
  }
  function cancel() {
    if (submitting.current) return
    if (missing) onMissing()
    else onCancel()
  }
  return (
    <Dialog
      label="Delete item"
      descriptionId={descriptionId}
      returnFocus={returnFocus}
      onCancel={cancel}
    >
      <form
        className={styles.form}
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2>Delete {target.kind === 'directory' ? 'folder' : 'file'}?</h2>
        <p id={descriptionId}>
          “{target.name}” will be permanently deleted. This cannot be undone.
        </p>
        {target.kind === 'directory' && (
          <label className={styles.confirmation}>
            <input
              type="checkbox"
              checked={recursive}
              disabled={pending || missing}
              onChange={(event) => {
                setRecursive(event.target.checked)
                setError(null)
              }}
            />
            Delete this folder and all its contents
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        {pending && (
          <p role="status">Deleting… Please wait before closing this dialog.</p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            data-dialog-initial-focus
            disabled={pending}
            onClick={cancel}
          >
            {missing ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" disabled={pending || missing}>
            {pending ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
