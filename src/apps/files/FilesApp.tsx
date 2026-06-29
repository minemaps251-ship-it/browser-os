import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useRuntime } from '../../app/runtimeContext'
import { createDirectorySession } from './session'
import { CreateEntryDialog, type CreateDestination } from './CreateEntryDialog'
import { RenameEntryForm, type RenameTarget } from './RenameEntryForm'
import { DeleteEntryDialog, type DeleteTarget } from './DeleteEntryDialog'
import { TransferEntryDialog, type TransferTarget } from './TransferEntryDialog'
import type { FileSystemNode, NodeId } from '../../core/filesystem/types'
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
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const openPending = useRef(false)
  const mounted = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const copyButton = useRef<HTMLButtonElement>(null)
  const moveButton = useRef<HTMLButtonElement>(null)
  const transferWindow = useRef<WindowId | null>(null)
  const [transferring, setTransferring] = useState<TransferTarget | null>(null)
  const deleteButton = useRef<HTMLButtonElement>(null)
  const deleteWindow = useRef<WindowId | null>(null)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const [operationNotice, setOperationNotice] = useState<string | null>(null)
  const renameWindow = useRef<WindowId | null>(null)
  const renameButton = useRef<HTMLButtonElement>(null)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const newFolder = useRef<HTMLButtonElement>(null)
  const newFile = useRef<HTMLButtonElement>(null)
  const [creation, setCreation] = useState<CreateDestination | null>(null)
  const focusAfterMutation = useRef<{
    kind:
      | CreateDestination['kind']
      | 'rename'
      | 'delete'
      | 'delete-cancel'
      | 'copy'
      | 'move'
    windowId: WindowId | null
  } | null>(null)
  const focusAfterNavigation = useRef<WindowId | null>(null)
  useEffect(() => {
    mounted.current = true
    session.start()
    return () => {
      mounted.current = false
      session.stop()
    }
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
    const completed = focusAfterMutation.current
    if (
      renaming ||
      deleting ||
      transferring ||
      snapshot.status !== 'ready' ||
      !completed
    )
      return
    focusAfterMutation.current = null
    if (runtime.windows.getState().focusedId === completed.windowId) {
      if (completed.kind === 'delete') {
        heading.current?.focus()
        return
      }
      const trigger = {
        copy: copyButton,
        move: moveButton,
        'delete-cancel': deleteButton,
        rename: renameButton,
        directory: newFolder,
        file: newFile,
      }[completed.kind]
      if (trigger.current?.disabled) heading.current?.focus()
      trigger.current?.focus()
    }
  }, [snapshot, runtime, renaming, deleting, transferring])
  async function openFile(id: NodeId) {
    if (openPending.current || renaming || creation || deleting || transferring)
      return
    openPending.current = true
    setOpening(true)
    setOpenError(null)
    try {
      const result = await runtime.openFile(id)
      if (mounted.current && !result.ok) setOpenError(result.message)
    } catch {
      if (mounted.current)
        setOpenError('This file could not be opened. Please try again.')
    } finally {
      openPending.current = false
      if (mounted.current) setOpening(false)
    }
  }
  function stopTransfer(destination?: NodeId) {
    if (!transferring) return
    if (destination) {
      setOperationNotice(
        transferring.mode === 'copy'
          ? 'The file has been copied.'
          : 'The item has been moved.',
      )
      if (
        transferring.mode === 'move' &&
        session.getSnapshot().directoryId !== destination
      ) {
        setSelected(null)
        setFileNotice(null)
      }
    }
    focusAfterMutation.current = {
      kind: transferring.mode,
      windowId: transferWindow.current,
    }
    setTransferring(null)
  }
  function startTransfer(mode: TransferTarget['mode'], entry: FileSystemNode) {
    if (
      renaming ||
      deleting ||
      creation ||
      transferring ||
      snapshot.status !== 'ready' ||
      (mode === 'copy' && entry.kind !== 'file') ||
      (mode === 'move' && entry.metadata.protected)
    )
      return
    transferWindow.current = runtime.windows.getState().focusedId
    setOperationNotice(null)
    setTransferring({ mode, id: entry.id, name: entry.name })
  }
  function stopDelete(clearSelection: boolean) {
    if (clearSelection) {
      setSelected(null)
      setFileNotice(null)
    }
    focusAfterMutation.current = {
      kind: clearSelection ? 'delete' : 'delete-cancel',
      windowId: deleteWindow.current,
    }
    setDeleting(null)
  }
  function startDelete(entry: FileSystemNode) {
    if (
      renaming ||
      creation ||
      transferring ||
      deleting ||
      snapshot.status !== 'ready' ||
      entry.metadata.protected
    )
      return
    deleteWindow.current = runtime.windows.getState().focusedId
    setDeleting({ id: entry.id, name: entry.name, kind: entry.kind })
    setOperationNotice(null)
  }
  function stopRename() {
    setRenaming(null)
    focusAfterMutation.current = {
      kind: 'rename',
      windowId: renameWindow.current,
    }
  }
  function startRename(entry: FileSystemNode) {
    if (
      renaming ||
      deleting ||
      creation ||
      transferring ||
      snapshot.status !== 'ready' ||
      !snapshot.directoryId ||
      entry.metadata.protected
    )
      return
    setOperationNotice(null)
    renameWindow.current = runtime.windows.getState().focusedId
    setSelected(entry.id)
    setFileNotice(null)
    setRenaming({
      id: entry.id,
      name: entry.name,
      directoryId: snapshot.directoryId,
    })
  }
  function navigate(id: NodeId) {
    if (renaming || deleting || transferring) return
    focusAfterNavigation.current = runtime.windows.getState().focusedId
    setSelected(null)
    setFileNotice(null)
    setOpenError(null)
    setOperationNotice(null)
    void session.navigate(id)
  }
  function openCreation(kind: CreateDestination['kind']) {
    if (
      renaming ||
      deleting ||
      transferring ||
      snapshot.status !== 'ready' ||
      !snapshot.directoryId
    )
      return
    setOperationNotice(null)
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
          disabled={!!renaming}
          onClick={() => {
            focusAfterNavigation.current = runtime.windows.getState().focusedId
            setSelected(null)
            setOpenError(null)
            setFileNotice(null)
            setOperationNotice(null)
            void session.home()
          }}
        >
          Home
        </button>
        <button
          disabled={!!renaming || !parent || snapshot.status !== 'ready'}
          onClick={() => {
            if (parent) navigate(parent.id)
          }}
        >
          Up
        </button>
        <button onClick={() => void session.reload()}>Refresh folder</button>
        <button
          ref={newFolder}
          disabled={!!renaming || snapshot.status !== 'ready'}
          onClick={() => openCreation('directory')}
        >
          New folder
        </button>
        <button
          ref={newFile}
          disabled={!!renaming || snapshot.status !== 'ready'}
          onClick={() => openCreation('file')}
        >
          New file
        </button>
        <button
          ref={renameButton}
          disabled={
            !!renaming ||
            snapshot.status !== 'ready' ||
            !selectedEntry ||
            selectedEntry.metadata.protected
          }
          onClick={() => {
            if (selectedEntry) startRename(selectedEntry)
          }}
        >
          Rename
        </button>
        <button
          ref={deleteButton}
          disabled={
            !!renaming ||
            snapshot.status !== 'ready' ||
            !selectedEntry ||
            selectedEntry.metadata.protected
          }
          onClick={() => {
            if (selectedEntry) startDelete(selectedEntry)
          }}
        >
          Delete
        </button>
        <button
          ref={copyButton}
          disabled={
            !!renaming ||
            snapshot.status !== 'ready' ||
            selectedEntry?.kind !== 'file'
          }
          onClick={() => {
            if (selectedEntry) startTransfer('copy', selectedEntry)
          }}
        >
          Copy
        </button>
        <button
          ref={moveButton}
          disabled={
            !!renaming ||
            snapshot.status !== 'ready' ||
            !selectedEntry ||
            selectedEntry.metadata.protected
          }
          onClick={() => {
            if (selectedEntry) startTransfer('move', selectedEntry)
          }}
        >
          Move
        </button>
        <button
          disabled={opening || !!renaming || selectedEntry?.kind !== 'file'}
          onClick={() => {
            if (selectedEntry?.kind === 'file') void openFile(selectedEntry.id)
          }}
        >
          Open
        </button>
      </div>
      {opening && <p role="status">Opening file…</p>}
      {openError && <p role="alert">{openError}</p>}
      {renaming && (
        <RenameEntryForm
          target={renaming}
          vfs={runtime.vfs}
          onCancel={stopRename}
          onRenamed={() => {
            if (session.getSnapshot().directoryId === renaming.directoryId) {
              setSelected(renaming.id)
              setFileNotice('The item has been renamed.')
            }
            stopRename()
          }}
        />
      )}
      <nav className={styles.breadcrumbs} aria-label="Folder path">
        {snapshot.breadcrumbs.map((crumb) => (
          <button
            key={crumb.id}
            disabled={!!renaming}
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
                <li key={entry.id} className={styles.row}>
                  <button
                    className={`${styles.entry} ${selectedEntry?.id === entry.id ? styles.selected : ''}`}
                    aria-label={`${entry.kind === 'directory' ? 'Open folder' : 'Select file'} ${entry.name}`}
                    data-selected={selectedEntry?.id === entry.id || undefined}
                    aria-pressed={
                      entry.kind === 'file'
                        ? selectedEntry?.id === entry.id
                        : undefined
                    }
                    disabled={!!renaming}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && entry.kind === 'file') {
                        event.preventDefault()
                        setSelected(entry.id)
                        void openFile(entry.id)
                        return
                      }
                      if (event.key === 'F2') {
                        event.preventDefault()
                        startRename(entry)
                      }
                    }}
                    onDoubleClick={() => {
                      if (entry.kind === 'file') void openFile(entry.id)
                    }}
                    onClick={() => {
                      if (entry.kind === 'directory') navigate(entry.id)
                      else {
                        setSelected(entry.id)
                        setOpenError(null)
                        setFileNotice(
                          'Use Open to open this file in its default application.',
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
                  {entry.kind === 'directory' && (
                    <button
                      className={styles.selectFolder}
                      aria-label={`Select folder ${entry.name}`}
                      aria-pressed={selectedEntry?.id === entry.id}
                      disabled={!!renaming}
                      onClick={() => {
                        setSelected(entry.id)
                        setOpenError(null)
                        setFileNotice(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'F2') {
                          event.preventDefault()
                          startRename(entry)
                        }
                      }}
                    >
                      Select
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {operationNotice && <p role="status">{operationNotice}</p>}
      {fileNotice && selectedEntry && <p role="status">{fileNotice}</p>}
      {transferring && (
        <TransferEntryDialog
          target={transferring}
          vfs={runtime.vfs}
          refresh={runtime.refresh}
          returnFocus={transferring.mode === 'copy' ? copyButton : moveButton}
          onCancel={() => stopTransfer()}
          onTransferred={stopTransfer}
        />
      )}
      {deleting && (
        <DeleteEntryDialog
          target={deleting}
          vfs={runtime.vfs}
          returnFocus={deleteButton}
          onCancel={() => stopDelete(false)}
          onDeleted={() => {
            setOperationNotice(`“${deleting.name}” has been deleted.`)
            stopDelete(true)
          }}
          onMissing={() => {
            stopDelete(true)
            void session.reload()
          }}
        />
      )}
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
              focusAfterMutation.current = {
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
