import { useId } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { useWorkspaceExport } from './useWorkspaceExport'
import styles from './SettingsApp.module.css'
export function WorkspaceExport() {
  const runtime = useRuntime()
  const { state, prepareCopy } = useWorkspaceExport(runtime.prepareExport)
  const id = useId()
  return (
    <section
      className={styles.storage}
      aria-labelledby={`${id}-title`}
      aria-busy={state.phase === 'busy'}
    >
      <h2 id={`${id}-title`}>Export data</h2>
      <p id={`${id}-description`} className={styles.help}>
        Prepare a JSON copy of all saved text files, folders and your appearance
        setting. Unsaved edits in Notes and Code Editor are not included.
      </p>
      {runtime.storageMode === 'temporary' && (
        <p className={styles.help}>
          This exports your current temporary workspace before it is lost on
          reload.
        </p>
      )}
      <button
        aria-disabled={state.phase === 'busy'}
        aria-describedby={`${id}-description`}
        onClick={() => void prepareCopy()}
      >
        Prepare export
      </button>
      {state.phase === 'busy' && <p role="status">Preparing export…</p>}
      {state.phase === 'error' && <p role="alert">{state.message}</p>}
      {state.phase === 'ready' && (
        <>
          <p role="status">
            Export ready: {state.artifact.fileCount}{' '}
            {state.artifact.fileCount === 1 ? 'file' : 'files'},{' '}
            {state.artifact.folderCount}{' '}
            {state.artifact.folderCount === 1 ? 'folder' : 'folders'} ·{' '}
            {(state.artifact.byteLength / 1024).toFixed(1)} KiB.
          </p>
          <a
            className={styles.download}
            href={state.url}
            download={state.artifact.filename}
          >
            Download JSON
          </a>
          <p className={styles.help}>
            The copy reflects the workspace when it was prepared. Prepare a new
            export after making changes. Import is not supported.
          </p>
        </>
      )}
    </section>
  )
}
