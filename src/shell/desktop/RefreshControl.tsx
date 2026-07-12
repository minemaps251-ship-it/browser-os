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
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" />
          <path d="M16 8h5V3" />
          <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" />
          <path d="M8 16H3v5" />
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
