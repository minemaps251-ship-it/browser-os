import type { ApplicationProps } from '../../app/builtInApps'
import { useNotesDocument } from './useNotesDocument'
import styles from './NotesApp.module.css'
export default function NotesApp({ launchInput }: ApplicationProps) {
  const { snapshot, retry } = useNotesDocument(launchInput)
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
          <p className={styles.hint}>Read only</p>
          <section
            aria-label="File contents"
            tabIndex={0}
            className={styles.content}
          >
            {snapshot.document.content.text ? (
              <pre>{snapshot.document.content.text}</pre>
            ) : (
              <p className={styles.hint}>This file is empty.</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
