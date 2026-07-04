import { useId, useRef, type ReactNode } from 'react'
import type { ApplicationProps } from '../../app/builtInApps'
import { SaveAsDialog } from './SaveAsDialog'
import { Dialog } from '../../ui/Dialog'
import { useTextDocument } from './useTextDocument'
import type { useDocumentControls } from './useDocumentControls'
import type { AppId } from '../../core/shared/ids'
import styles from './TextDocument.module.css'
export function TextDocumentApp({
  appId,
  code = false,
  ...props
}: ApplicationProps & { appId: AppId; code?: boolean }) {
  const notes = useTextDocument(props, appId)
  return <TextDocumentView model={notes} code={code} />
}
export function TextDocumentView({
  model: notes,
  code = false,
  showNew = true,
  editor,
}: {
  model: ReturnType<typeof useDocumentControls>
  code?: boolean
  showNew?: boolean
  editor?: ReactNode
}) {
  const { snapshot, retry } = notes
  const saveButton = useRef<HTMLButtonElement>(null)
  const inputId = useId(),
    closeDescriptionId = useId()
  return (
    <div className={`${styles.app} ${code ? styles.code : ''}`}>
      {showNew && <button onClick={notes.newDocument}>New document</button>}
      {snapshot.status === 'loading' && <p role="status">Loading file…</p>}
      {snapshot.status === 'error' && (
        <>
          <p role="alert">{snapshot.message}</p>
          <button onClick={() => void retry()}>Retry file</button>
        </>
      )}
      {snapshot.status === 'ready' && (
        <>
          <h2 className={styles.title}>{snapshot.name}</h2>
          <p className={styles.path}>{snapshot.path}</p>
          <div className={styles.actions}>
            <button
              ref={saveButton}
              disabled={
                snapshot.saving ||
                (!!snapshot.fileId && !snapshot.dirty) ||
                snapshot.conflict ||
                snapshot.availability !== 'available'
              }
              onClick={() => void notes.save()}
            >
              Save
            </button>
            <button disabled={snapshot.saving} onClick={notes.openSaveAs}>
              Save as
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
                      : snapshot.fileId
                        ? 'Saved'
                        : 'Not saved'}
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
            {editor ?? (
              <>
                <label htmlFor={inputId}>{code ? 'Code' : 'Text'}</label>
                <textarea
                  id={inputId}
                  value={snapshot.buffer}
                  maxLength={1048576}
                  spellCheck={false}
                  wrap={code ? 'off' : 'soft'}
                  onChange={(event) => notes.edit(event.target.value)}
                  onCompositionStart={notes.onCompositionStart}
                  onCompositionEnd={notes.onCompositionEnd}
                  onKeyDown={notes.onEditorKeyDown}
                />
              </>
            )}
            {code && !editor && (
              <p className={styles.hint}>
                {snapshot.buffer.split('\n').length} lines ·{' '}
                {snapshot.buffer.length} characters · Plain text
              </p>
            )}
            {!snapshot.buffer && (
              <p className={styles.hint}>This file is empty.</p>
            )}
          </section>
          {notes.saveAsOpen && (
            <SaveAsDialog
              initialName={snapshot.fileId ? snapshot.name : 'Untitled.txt'}
              save={notes.saveAs}
              onSaved={notes.savedAs}
              onCancel={notes.cancelSaveAs}
              returnFocus={saveButton}
            />
          )}
          {snapshot.closing && !notes.saveAsOpen && (
            <Dialog
              label="Unsaved changes"
              descriptionId={closeDescriptionId}
              returnFocus={saveButton}
              onCancel={notes.cancelClose}
            >
              <h2>Save changes before closing?</h2>
              <p id={closeDescriptionId}>
                Your changes to “{snapshot.name}” have not been saved.
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
