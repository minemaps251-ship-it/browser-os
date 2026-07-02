import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { useCommandHistory } from './useCommandHistory'
import { createTerminalSession } from './session'
import styles from './TerminalApp.module.css'
export default function TerminalApp() {
  const runtime = useRuntime()
  const [session] = useState(() =>
    createTerminalSession(runtime.vfs, runtime.refresh),
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const history = useCommandHistory()
  const { draft, setDraft } = history
  const inputId = useId()
  const historyHintId = useId()
  const output = useRef<HTMLDivElement>(null)
  const followOutput = useRef(true)
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
        Use help to see available commands. This terminal works with your
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
          if (
            history.isComposing() ||
            snapshot.status !== 'ready' ||
            !draft.trim()
          )
            return
          const command = draft
          history.submit()
          void session.run(command)
        }}
      >
        <label htmlFor={inputId}>Command</label>
        <p id={historyHintId} className={styles.help}>
          Use ↑ and ↓ to recall commands.
        </p>
        <div className={styles.controls}>
          <input
            id={inputId}
            aria-describedby={historyHintId}
            value={draft}
            maxLength={4096}
            autoComplete="off"
            spellCheck={false}
            readOnly={snapshot.status !== 'ready'}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={history.onCompositionStart}
            onCompositionEnd={history.onCompositionEnd}
            onKeyDown={(event) => {
              history.onKeyDown(event, snapshot.status === 'ready')
              if (
                event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !event.shiftKey &&
                event.key.toLowerCase() === 'l' &&
                !history.isComposing() &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault()
                if (snapshot.status === 'ready') void session.run('clear')
              }

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
