import { useId, useRef } from 'react'
import type { ApplicationProps } from '../../app/builtInApps'
import { Dialog } from '../../ui/Dialog'
import { useNotesDocument } from './useNotesDocument'
import styles from './NotesApp.module.css'
export default function NotesApp(props: ApplicationProps) {
  const notes = useNotesDocument(props)
  const { snapshot, retry } = notes
  const saveButton = useRef<HTMLButtonElement>(null)
  const inputId = useId(),
    closeDescriptionId = useId()
  return (
    <div className={styles.app}>
      {snapshot.status === 'idle' && (
        <p>Open a text file from Files to read it in Notes.</p>
      )}
      {snapshot.status === 'loading' && <p role="status">Loading file…</p>}
      {snapshot.status === 'error' && (
        <>
          <p role="alert">{snapshot.message}</p>
          <button onClick={() => void retry()}>Retry file</button>
        </>
      )}
      {snapshot.status === 'ready' && (
        <>
          <h2 className={styles.title}>{snapshot.document.node.name}</h2>
          <p className={styles.path}>{snapshot.path}</p>
          <div className={styles.actions}>
            <button
              ref={saveButton}
              disabled={
                snapshot.saving ||
                !snapshot.dirty ||
                snapshot.conflict ||
                snapshot.availability !== 'available'
              }
              onClick={() => void notes.save()}
            >
              Save
            </button>
            <p role="status">
              {snapshot.saving
                ? 'Saving…'
                : snapshot.conflict
                  ? 'Conflict — edits kept'
                  : snapshot.availability !== 'available'
                    ? 'File unavailable — text kept'
                    : snapshot.dirty
                      ? 'Unsaved changes'
                      : 'Saved'}
            </p>
          </div>
          {snapshot.notice && <p role="alert">{snapshot.notice}</p>}
          {snapshot.availability !== 'available' && (
            <button disabled={snapshot.saving} onClick={() => void retry()}>
              Retry file
            </button>
          )}
          {snapshot.conflict && (
            <button
              disabled={snapshot.saving}
              onClick={() => void notes.discardAndReload()}
            >
              Discard edits and reload
            </button>
          )}
          <section
            aria-label="File contents"
            tabIndex={0}
            className={styles.content}
          >
            <label htmlFor={inputId}>Text</label>
            <textarea
              id={inputId}
              value={snapshot.buffer}
              maxLength={1048576}
              spellCheck={false}
              onChange={(event) => notes.edit(event.target.value)}
              onCompositionStart={notes.onCompositionStart}
              onCompositionEnd={notes.onCompositionEnd}
              onKeyDown={notes.onEditorKeyDown}
            />
            {!snapshot.buffer && (
              <p className={styles.hint}>This file is empty.</p>
            )}
          </section>
          {snapshot.closing && (
            <Dialog
              label="Unsaved changes"
              descriptionId={closeDescriptionId}
              returnFocus={saveButton}
              onCancel={notes.cancelClose}
            >
              <h2>Save changes before closing?</h2>
              <p id={closeDescriptionId}>
                Your changes to “{snapshot.document.node.name}” have not been
                saved.
              </p>
              {snapshot.notice && <p role="alert">{snapshot.notice}</p>}
              {snapshot.saving && <p role="status">Saving… Please wait.</p>}
              <div className={styles.actions}>
                <button
                  data-dialog-initial-focus
                  disabled={snapshot.saving}
                  onClick={notes.cancelClose}
                >
                  Cancel
                </button>
                <button disabled={snapshot.saving} onClick={notes.discardClose}>
                  Discard changes
                </button>
                <button
                  disabled={
                    snapshot.saving ||
                    snapshot.conflict ||
                    snapshot.availability !== 'available'
                  }
                  onClick={() => void notes.saveAndClose()}
                >
                  Save and close
                </button>
              </div>
            </Dialog>
          )}
        </>
      )}
    </div>
  )
}
