import { useEffect, useId, useRef, useState } from 'react'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { NodeId } from '../../core/filesystem/types'
import { renameErrorMessage } from './renameError'
import styles from './RenameEntryForm.module.css'

export interface RenameTarget {
  readonly id: NodeId
  readonly name: string
  readonly directoryId: NodeId
}

export function RenameEntryForm({
  target,
  vfs,
  onCancel,
  onRenamed,
}: {
  target: RenameTarget
  vfs: Pick<VirtualFileSystem, 'rename'>
  onCancel: () => void
  onRenamed: () => void
}) {
  const [name, setName] = useState(target.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{
    message: string
    invalidName: boolean
  } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const fieldId = useId()
  const errorId = useId()
  useEffect(() => {
    mounted.current = true
    input.current?.focus()
    input.current?.select()
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
      const result = await vfs.rename(target.id, name)
      if (!mounted.current) return
      if (result.ok) onRenamed()
      else
        setError({
          message: renameErrorMessage(result.error.code),
          invalidName:
            result.error.code === 'INVALID_NAME' ||
            result.error.code === 'ALREADY_EXISTS',
        })
    } catch {
      if (mounted.current)
        setError({
          message: 'The item could not be renamed. Please try again.',
          invalidName: false,
        })
    } finally {
      submitting.current = false
      if (mounted.current) setPending(false)
    }
  }
  return (
    <form
      className={styles.form}
      aria-label="Rename item"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (!submitting.current) onCancel()
        }
      }}
    >
      <label htmlFor={fieldId}>Rename {target.name}</label>
      <div className={styles.controls}>
        <input
          ref={input}
          id={fieldId}
          value={name}
          readOnly={pending}
          autoComplete="off"
          aria-invalid={error?.invalidName || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(null)
          }}
        />
        <button type="submit" disabled={pending}>
          {pending ? 'Renaming…' : 'Save name'}
        </button>
        <button type="button" disabled={pending} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert">
          {error.message}
        </p>
      )}
      {pending && <p role="status">Renaming… Please wait before cancelling.</p>}
    </form>
  )
}
