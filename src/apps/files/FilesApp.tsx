import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { createDirectorySession } from './session'
import { CreateEntryDialog, type CreateDestination } from './CreateEntryDialog'
import type { NodeId } from '../../core/filesystem/types'
import type { WindowId } from '../../core/shared/ids'
import styles from './FilesApp.module.css'
export default function FilesApp() {
  const runtime = useRuntime()
  const [session] = useState(() =>
    createDirectorySession(runtime.vfs, runtime.refresh),
  )
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [selected, setSelected] = useState<NodeId | null>(null)
  const [fileNotice, setFileNotice] = useState<string | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const newFolder = useRef<HTMLButtonElement>(null)
  const newFile = useRef<HTMLButtonElement>(null)
  const [creation, setCreation] = useState<CreateDestination | null>(null)
  const focusAfterCreation = useRef<{
    kind: CreateDestination['kind']
    windowId: WindowId | null
  } | null>(null)
  const focusAfterNavigation = useRef<WindowId | null>(null)
  useEffect(() => {
    session.start()
    return session.stop
  }, [session])
  useEffect(() => {
    if (snapshot.status === 'ready' && focusAfterNavigation.current) {
      const navigationWindow = focusAfterNavigation.current
      focusAfterNavigation.current = null
      if (runtime.windows.getState().focusedId === navigationWindow) {
        heading.current?.focus()
      }
    }
  }, [snapshot.status, snapshot.directoryId, runtime])
  useEffect(() => {
    const completed = focusAfterCreation.current
    if (snapshot.status !== 'ready' || !completed) return
    focusAfterCreation.current = null
    if (runtime.windows.getState().focusedId === completed.windowId) {
      const trigger = completed.kind === 'directory' ? newFolder : newFile
      trigger.current?.focus()
    }
  }, [snapshot, runtime])
  function navigate(id: NodeId) {
    focusAfterNavigation.current = runtime.windows.getState().focusedId
    setSelected(null)
    setFileNotice(null)
    void session.navigate(id)
  }
  function openCreation(kind: CreateDestination['kind']) {
    if (snapshot.status !== 'ready' || !snapshot.directoryId) return
    setCreation({
      kind,
      parentId: snapshot.directoryId,
      parentName: snapshot.breadcrumbs.at(-1)?.name ?? 'Workspace',
    })
  }
  const parent = snapshot.breadcrumbs.at(-2)
  const selectedEntry = snapshot.entries.find((entry) => entry.id === selected)
  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <button
          onClick={() => {
            focusAfterNavigation.current = runtime.windows.getState().focusedId
            setSelected(null)
            setFileNotice(null)
            void session.home()
          }}
        >
          Home
        </button>
        <button
          disabled={!parent || snapshot.status !== 'ready'}
          onClick={() => {
            if (parent) navigate(parent.id)
          }}
        >
          Up
        </button>
        <button onClick={() => void session.reload()}>Refresh folder</button>
        <button
          ref={newFolder}
          disabled={snapshot.status !== 'ready'}
          onClick={() => openCreation('directory')}
        >
          New folder
        </button>
        <button
          ref={newFile}
          disabled={snapshot.status !== 'ready'}
          onClick={() => openCreation('file')}
        >
          New file
        </button>
      </div>
      <nav className={styles.breadcrumbs} aria-label="Folder path">
        {snapshot.breadcrumbs.map((crumb) => (
          <button
            key={crumb.id}
            aria-current={
              crumb.id === snapshot.directoryId ? 'location' : undefined
            }
            onClick={() => navigate(crumb.id)}
          >
            {crumb.name}
          </button>
        ))}
      </nav>
      <h3 ref={heading} tabIndex={-1} className={styles.heading}>
        {snapshot.breadcrumbs.at(-1)?.name ?? 'Files'}
      </h3>
      {snapshot.status === 'loading' && <p role="status">Loading folder…</p>}
      {snapshot.status === 'error' && (
        <div role="alert">
          <p>{snapshot.error}</p>
          <button onClick={() => void session.reload()}>Retry folder</button>
        </div>
      )}
      {snapshot.notice && <p role="status">{snapshot.notice}</p>}
      {snapshot.status === 'ready' && (
        <>
          {snapshot.entries.length === 0 ? (
            <p className={styles.empty}>This folder is empty.</p>
          ) : (
            <ul className={styles.list} aria-label="Folder contents">
              {snapshot.entries.map((entry) => (
                <li key={entry.id}>
                  <button
                    className={`${styles.entry} ${selectedEntry?.id === entry.id ? styles.selected : ''}`}
                    aria-label={`${entry.kind === 'directory' ? 'Open folder' : 'Select file'} ${entry.name}`}
                    data-selected={selectedEntry?.id === entry.id || undefined}
                    aria-pressed={
                      entry.kind === 'file'
                        ? selectedEntry?.id === entry.id
                        : undefined
                    }
                    onClick={() => {
                      if (entry.kind === 'directory') navigate(entry.id)
                      else {
                        setSelected(entry.id)
                        setFileNotice(
                          'File opening will be available when a text application is added.',
                        )
                      }
                    }}
                  >
                    <svg
                      className={styles.icon}
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      {entry.kind === 'directory' ? (
                        <path d="M3 6h7l2 3h9v11H3z" />
                      ) : (
                        <path d="M6 3h8l4 4v14H6z" />
                      )}
                    </svg>
                    <span className={styles.name}>{entry.name}</span>
                    <span className={styles.kind}>
                      {entry.kind === 'directory'
                        ? 'Folder'
                        : `${entry.byteLength} bytes`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {fileNotice && selectedEntry && <p role="status">{fileNotice}</p>}
      {creation && (
        <CreateEntryDialog
          destination={creation}
          vfs={runtime.vfs}
          returnFocus={creation.kind === 'directory' ? newFolder : newFile}
          onCancel={() => setCreation(null)}
          onCreated={(id) => {
            if (session.getSnapshot().directoryId === creation.parentId) {
              setSelected(id)
              setFileNotice('The new item has been created.')
              focusAfterCreation.current = {
                kind: creation.kind,
                windowId: runtime.windows.getState().focusedId,
              }
            }
            setCreation(null)
          }}
        />
      )}
    </div>
  )
}
