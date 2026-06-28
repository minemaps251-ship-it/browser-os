import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Dialog } from '../../ui/Dialog'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { NodeId } from '../../core/filesystem/types'
import { createErrorMessage } from './createError'
import styles from './CreateEntryDialog.module.css'

export interface CreateDestination {
  readonly kind: 'directory' | 'file'
  readonly parentId: NodeId
  readonly parentName: string
}

export function CreateEntryDialog({
  destination,
  vfs,
  returnFocus,
  onCancel,
  onCreated,
}: {
  destination: CreateDestination
  vfs: Pick<VirtualFileSystem, 'createDirectory' | 'createFile'>
  returnFocus: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onCreated: (id: NodeId) => void
}) {
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{
    message: string
    invalidName: boolean
  } | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const fieldId = useId()
  const errorId = useId()
  const descriptionId = useId()
  const title = destination.kind === 'directory' ? 'New folder' : 'New file'
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const result =
        destination.kind === 'directory'
          ? await vfs.createDirectory(destination.parentId, name)
          : await vfs.createFile(destination.parentId, name, {
              kind: 'text',
              encoding: 'utf-8',
              text: '',
            })
      if (!mounted.current) return
      if (result.ok) onCreated(result.value)
      else
        setError({
          message: createErrorMessage(result.error.code),
          invalidName:
            result.error.code === 'INVALID_NAME' ||
            result.error.code === 'ALREADY_EXISTS',
        })
    } catch {
      if (mounted.current)
        setError({
          message: 'The item could not be created. Please try again.',
          invalidName: false,
        })
    } finally {
      submitting.current = false
      if (mounted.current) setPending(false)
    }
  }
  return (
    <Dialog
      label={title}
      descriptionId={descriptionId}
      returnFocus={returnFocus}
      onCancel={() => {
        if (!submitting.current) onCancel()
      }}
    >
      <form
        className={styles.form}
        aria-busy={pending}
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2>{title}</h2>
        <p id={descriptionId}>
          Create in {destination.parentName}.
          {destination.kind === 'file' && ' The new text file will be empty.'}
        </p>
        <label htmlFor={fieldId}>Name</label>
        <input
          id={fieldId}
          data-dialog-initial-focus
          value={name}
          readOnly={pending}
          aria-invalid={error?.invalidName || undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        {error && (
          <p id={errorId} role="alert">
            {error.message}
          </p>
        )}
        {pending && (
          <p role="status">Creating… Please wait before closing this dialog.</p>
        )}
        <div className={styles.actions}>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={pending}>
            {pending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
