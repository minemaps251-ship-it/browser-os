import { useId, type RefObject } from 'react'
import { Dialog } from '../../ui/Dialog'
import { useSaveAsDestination } from './useSaveAsDestination'
import type { NodeId, VfsResult } from '../../core/filesystem/types'
import styles from './TextDocument.module.css'
export function SaveAsDialog({
  initialName,
  save,
  onSaved,
  onCancel,
  returnFocus,
}: {
  initialName: string
  save: (parent: NodeId, name: string) => Promise<VfsResult<NodeId>>
  onSaved: () => void
  onCancel: () => void
  returnFocus: RefObject<HTMLButtonElement | null>
}) {
  const destination = useSaveAsDestination(initialName, save, onSaved)
  const nameId = useId(),
    descriptionId = useId(),
    errorId = useId()
  const { directory, pending } = destination
  return (
    <Dialog
      label="Save as"
      descriptionId={descriptionId}
      returnFocus={returnFocus}
      onCancel={() => {
        if (!pending) onCancel()
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void destination.submit()
        }}
        aria-busy={pending}
      >
        <h2>Save as</h2>
        <p id={descriptionId}>
          Choose a folder and file name. Existing files will not be overwritten.
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            disabled={pending}
            onClick={() => void destination.home()}
          >
            Home
          </button>
          <button
            type="button"
            disabled={pending || !directory.directoryId}
            onClick={() => void destination.up()}
          >
            Up
          </button>
        </div>
        <p className={styles.path}>
          {directory.breadcrumbs.map((entry) => entry.name || '/').join(' / ')}
        </p>
        {directory.status === 'loading' && (
          <p role="status">Loading folders…</p>
        )}
        {directory.status === 'error' && (
          <>
            <p role="alert">{directory.error}</p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void destination.retry()}
            >
              Retry folders
            </button>
          </>
        )}
        <div className={styles.folders} aria-label="Destination folders">
          {directory.entries
            .filter((entry) => entry.kind === 'directory')
            .map((entry) => (
              <button
                type="button"
                disabled={pending}
                key={entry.id}
                onClick={() => void destination.navigate(entry.id)}
              >
                Open folder {entry.name}
              </button>
            ))}
        </div>
        <label htmlFor={nameId}>File name</label>
        <input
          id={nameId}
          data-dialog-initial-focus
          value={destination.name}
          disabled={pending}
          onChange={(event) => destination.setName(event.target.value)}
          aria-invalid={!!destination.error}
          aria-describedby={destination.error ? errorId : undefined}
        />
        {destination.error && (
          <p id={errorId} role="alert">
            {destination.error}
          </p>
        )}
        {pending && <p role="status">Saving… Please wait.</p>}
        <div className={styles.actions}>
          <button type="button" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || directory.status !== 'ready'}
          >
            Save file
          </button>
        </div>
      </form>
    </Dialog>
  )
}
