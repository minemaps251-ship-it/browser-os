import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { Dialog } from '../../ui/Dialog'
import { createDirectorySession } from './session'
import type { VirtualFileSystem } from '../../core/filesystem/service'
import type { RefreshService } from '../../core/refresh/service'
import type { NodeId } from '../../core/filesystem/types'
import { transferErrorMessage } from './transferError'
import styles from './TransferEntryDialog.module.css'
export interface TransferTarget {
  readonly id: NodeId
  readonly name: string
  readonly mode: 'copy' | 'move'
}
export function TransferEntryDialog({
  target,
  vfs,
  refresh,
  returnFocus,
  onCancel,
  onTransferred,
}: {
  target: TransferTarget
  vfs: VirtualFileSystem
  refresh: RefreshService
  returnFocus: RefObject<HTMLButtonElement | null>
  onCancel: () => void
  onTransferred: (destination: NodeId) => void
}) {
  const [session] = useState(() => createDirectorySession(vfs, refresh))
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [name, setName] = useState(target.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{
    message: string
    invalidName: boolean
  } | null>(null)
  const submitting = useRef(false)
  const mounted = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusNavigation = useRef(false)
  const fieldId = useId()
  const errorId = useId()
  const descriptionId = useId()
  const verb = target.mode === 'copy' ? 'Copy' : 'Move'
  useEffect(() => {
    mounted.current = true
    session.start()
    return () => {
      mounted.current = false
      session.stop()
    }
  }, [session])
  useEffect(() => {
    if (snapshot.status === 'ready' && focusNavigation.current) {
      focusNavigation.current = false
      heading.current?.focus()
    }
  }, [snapshot])
  function navigate(id: NodeId) {
    if (submitting.current) return
    setError(null)
    focusNavigation.current = true
    void session.navigate(id)
  }
  async function submit() {
    const destination = session.getSnapshot()
    if (
      submitting.current ||
      destination.status !== 'ready' ||
      !destination.directoryId
    )
      return
    const id = destination.directoryId
    submitting.current = true
    setPending(true)
    setError(null)
    try {
      const result =
        target.mode === 'copy'
          ? await vfs.copyFile(target.id, id, name)
          : await vfs.move(target.id, id, name)
      if (!mounted.current) return
      if (result.ok) onTransferred(id)
      else
        setError({
          message: transferErrorMessage(result.error.code),
          invalidName:
            result.error.code === 'INVALID_NAME' ||
            result.error.code === 'ALREADY_EXISTS',
        })
    } catch {
      if (mounted.current)
        setError({
          message: 'The operation could not be completed. Please try again.',
          invalidName: false,
        })
    } finally {
      submitting.current = false
      if (mounted.current) setPending(false)
    }
  }
  const folders = snapshot.entries.filter((entry) => entry.kind === 'directory')
  const parent = snapshot.breadcrumbs.at(-2)
  return (
    <Dialog
      label={`${verb} item`}
      descriptionId={descriptionId}
      returnFocus={returnFocus}
      onCancel={() => {
        if (!submitting.current) onCancel()
      }}
    >
      <div className={styles.content}>
        <h2>{verb} to folder</h2>
        <p id={descriptionId}>
          Choose a destination for “{target.name}”. Existing items will not be
          overwritten.
        </p>
        <div className={styles.navigation}>
          <button
            type="button"
            data-dialog-initial-focus
            disabled={pending}
            onClick={() => {
              setError(null)
              focusNavigation.current = true
              void session.home()
            }}
          >
            Home
          </button>
          <button
            type="button"
            disabled={pending || !parent || snapshot.status !== 'ready'}
            onClick={() => {
              if (parent) navigate(parent.id)
            }}
          >
            Up
          </button>
        </div>
        <nav aria-label="Destination path" className={styles.navigation}>
          {snapshot.breadcrumbs.map((crumb) => (
            <button
              type="button"
              key={crumb.id}
              disabled={pending}
              aria-current={
                crumb.id === snapshot.directoryId ? 'location' : undefined
              }
              onClick={() => navigate(crumb.id)}
            >
              {crumb.name}
            </button>
          ))}
        </nav>
        <h3 ref={heading} tabIndex={-1}>
          {snapshot.breadcrumbs.at(-1)?.name ?? 'Destination'}
        </h3>
        {snapshot.notice && <p role="status">{snapshot.notice}</p>}
        {snapshot.status === 'loading' && <p role="status">Loading folders…</p>}
        {snapshot.status === 'error' && (
          <div role="alert">
            <p>{snapshot.error}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void session.reload()}
            >
              Retry folders
            </button>
          </div>
        )}
        {snapshot.status === 'ready' && (
          <ul className={styles.folders} aria-label="Destination folders">
            {folders.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => navigate(entry.id)}
                >
                  Open destination {entry.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {snapshot.status === 'ready' && folders.length === 0 && (
          <p>No subfolders. You can use this folder as the destination.</p>
        )}
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label htmlFor={fieldId}>Name at destination</label>
          <input
            className={styles.name}
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
          {error && (
            <p id={errorId} role="alert">
              {error.message}
            </p>
          )}
          {pending && (
            <p role="status">
              {verb === 'Copy' ? 'Copying' : 'Moving'}… Please wait before
              closing this dialog.
            </p>
          )}
          <div className={styles.actions}>
            <button type="button" disabled={pending} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || snapshot.status !== 'ready'}
            >
              {verb} here
            </button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}
