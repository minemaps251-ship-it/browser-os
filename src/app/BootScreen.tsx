import { useSyncExternalStore } from 'react'
import { BrowserOS } from './BrowserOS'
import type { BootController } from './boot'
import styles from './BootScreen.module.css'

export function BootScreen({ controller }: { controller: BootController }) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  )
  if (state.status === 'ready') return <BrowserOS runtime={state.runtime} />
  if (state.status === 'stopped') return null
  return (
    <main className={styles.screen}>
      <section className={styles.card} aria-labelledby="boot-heading">
        <h1 id="boot-heading">
          {state.status === 'loading'
            ? 'Opening your workspace'
            : 'Workspace unavailable'}
        </h1>
        {state.status === 'loading' ? (
          <p role="status">Preparing your files…</p>
        ) : (
          <>
            <p role="alert">{state.message}</p>
            <div className={styles.actions}>
              <button
                ref={(button) => button?.focus()}
                onClick={() => void controller.start()}
              >
                Retry
              </button>
              <button onClick={controller.useTemporary}>
                Use a temporary workspace
              </button>
            </div>
            <p>
              Temporary files will be lost when you reload or close this tab.
            </p>
          </>
        )}
      </section>
    </main>
  )
}
