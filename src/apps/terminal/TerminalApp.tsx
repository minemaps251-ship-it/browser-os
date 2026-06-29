import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { createTerminalSession } from './session'
import styles from './TerminalApp.module.css'
export default function TerminalApp() {
  const runtime = useRuntime()
  const [session] = useState(() =>
    createTerminalSession(runtime.vfs, runtime.refresh),
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const output = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
  const composing = useRef(false)
  useEffect(() => {
    session.start()
    return session.stop
  }, [session])
  useEffect(() => {
    if (output.current && followOutput.current)
      output.current.scrollTop = output.current.scrollHeight
  }, [snapshot.entries])
  return (
    <div className={styles.app}>
      <p className={styles.path}>{snapshot.path || 'Starting terminal…'}</p>
      <p className={styles.help}>
        Use pwd, ls, cd, mkdir, touch or help. This terminal works with your
        BrowserOS files.
      </p>
      {snapshot.notice && (
        <p role={snapshot.status === 'error' ? 'alert' : 'status'}>
          {snapshot.notice}
        </p>
      )}
      {snapshot.status === 'error' && (
        <button onClick={() => void session.retry()}>Retry terminal</button>
      )}
      {snapshot.trimmed && (
        <p>Earlier output was removed to keep the terminal responsive.</p>
      )}
      <div
        ref={output}
        onScroll={(event) => {
          const element = event.currentTarget
          followOutput.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 24
        }}
        role="log"
        aria-label="Terminal output"
        aria-live="polite"
        className={styles.output}
        tabIndex={0}
      >
        {snapshot.entries.map((entry) => (
          <div key={entry.id} className={styles.entry}>
            <p className={styles.command}>$ {entry.command}</p>
            {entry.stdout && <pre>{entry.stdout}</pre>}
            {entry.stderr && <pre className={styles.error}>{entry.stderr}</pre>}
            {entry.exitCode !== 0 && (
              <p className={styles.exit}>Exit code: {entry.exitCode}</p>
            )}
          </div>
        ))}
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (composing.current || snapshot.status !== 'ready' || !draft.trim())
            return
          const command = draft
          setDraft('')
          void session.run(command)
        }}
      >
        <label htmlFor={inputId}>Command</label>
        <div className={styles.controls}>
          <input
            id={inputId}
            value={draft}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            readOnly={snapshot.status !== 'ready'}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => {
              composing.current = true
            }}
            onCompositionEnd={() => {
              composing.current = false
            }}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.nativeEvent.isComposing || composing.current)
              )
                event.preventDefault()
              if (
                event.ctrlKey &&
                event.key.toLowerCase() === 'c' &&
                snapshot.status === 'busy' &&
                snapshot.cancellable &&
                event.currentTarget.selectionStart ===
                  event.currentTarget.selectionEnd
              ) {
                event.preventDefault()
                session.cancel()
              }
            }}
          />
          <button
            type="submit"
            disabled={snapshot.status !== 'ready' || !draft.trim()}
          >
            Run
          </button>
          {snapshot.status === 'busy' && (
            <button
              type="button"
              disabled={!snapshot.cancellable}
              onClick={session.cancel}
            >
              Cancel command
            </button>
          )}
        </div>
      </form>
      {snapshot.status === 'busy' && (
        <p role="status">
          {snapshot.cancellable
            ? 'Running command…'
            : 'Saving change… Please wait for the result.'}
        </p>
      )}
    </div>
  )
}
