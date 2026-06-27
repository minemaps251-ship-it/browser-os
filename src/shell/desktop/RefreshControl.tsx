import { useSyncExternalStore } from 'react'
import type { RefreshService } from '../../core/refresh/service'
import styles from './RefreshControl.module.css'
export function RefreshControl({ refresh }: { refresh: RefreshService }) {
  const snapshot = useSyncExternalStore(refresh.subscribe, refresh.getSnapshot)
  return (
    <div className={styles.control}>
      <button
        className={styles.button}
        aria-label="Refresh workspace"
        title="Refresh workspace"
        aria-disabled={snapshot.refreshing}
        onClick={() => {
          if (!snapshot.refreshing) void refresh.request()
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 7v5h-5M4 17v-5h5M6.2 7A7 7 0 0 1 20 12M17.8 17A7 7 0 0 1 4 12" />
        </svg>
      </button>
      {snapshot.refreshing && (
        <span className={styles.message} role="status">
          Updating workspace…
        </span>
      )}
      {!snapshot.refreshing && snapshot.error && (
        <p className={styles.message} role="alert">
          {snapshot.error}
        </p>
      )}
      {!snapshot.refreshing && !snapshot.error && snapshot.revision > 0 && (
        <span className={styles.announcement} role="status">
          Workspace updated.
        </span>
      )}
    </div>
  )
}
