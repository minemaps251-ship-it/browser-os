import { useEffect, useId, useRef } from 'react'
import type { ApplicationProps } from '../../app/builtInApps'
import { CodeSurface } from './CodeSurface'
import { useEngineOwner } from './useEngineOwner'
import type { EngineOwner } from './engine/owner'
import { TextDocumentView } from '../text-document/TextDocumentApp'
import { useDocumentControls } from '../text-document/useDocumentControls'
import { useEditorWorkspace } from './useEditorWorkspace'
import type { EditorTab, EditorWorkspace } from './workspace'
import styles from './CodeEditorApp.module.css'
function DocumentPanel({
  tab,
  workspace,
  owner,
}: {
  tab: EditorTab
  workspace: EditorWorkspace
  owner: EngineOwner
}) {
  const controls = useDocumentControls(
    tab.session,
    () => {
      workspace.newDocument()
    },
    { onModalChange: workspace.setModalOpen, warnOnExit: false },
  )
  return (
    <TextDocumentView
      model={controls}
      code
      showNew={false}
      editor={<CodeSurface tab={tab} owner={owner} model={controls} />}
    />
  )
}
function tabName(tab: EditorTab) {
  return tab.document.status === 'ready'
    ? tab.document.name
    : tab.document.status === 'error'
      ? 'Unavailable file'
      : 'Loading…'
}
export default function CodeEditorApp(props: ApplicationProps) {
  const { workspace, snapshot } = useEditorWorkspace(props)
  const owner = useEngineOwner(workspace)
  const prefix = useId()
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const previous = useRef(snapshot.activeId)
  const newTabButton = useRef<HTMLButtonElement>(null)
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeId)
  const locked = snapshot.closing || snapshot.modalOpen
  useEffect(() => {
    if (locked) return
    if (previous.current !== snapshot.activeId) {
      if (snapshot.activeId) buttons.current.get(snapshot.activeId)?.focus()
      else newTabButton.current?.focus()
    }
    previous.current = snapshot.activeId
  }, [snapshot.activeId, locked])
  return (
    <div className={styles.app}>
      <div className={styles.toolbar}>
        <div
          className={styles.tabs}
          role="tablist"
          aria-label="Editor documents"
          aria-describedby={`${prefix}-hint`}
        >
          {snapshot.tabs.map((tab, index) => {
            const selected = tab.id === snapshot.activeId
            const dirty = tab.document.status === 'ready' && tab.document.dirty
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  if (element) buttons.current.set(tab.id, element)
                  else buttons.current.delete(tab.id)
                }}
                role="tab"
                id={`${prefix}-${tab.id}`}
                aria-controls={`${prefix}-panel-${tab.id}`}
                aria-selected={selected}
                aria-label={`${tabName(tab)}${dirty ? ', unsaved changes' : ''}`}
                aria-disabled={locked}
                tabIndex={selected ? 0 : -1}
                onClick={() => workspace.select(tab.id)}
                onKeyDown={(event) => {
                  if (
                    locked ||
                    event.ctrlKey ||
                    event.metaKey ||
                    event.altKey ||
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                  )
                    return
                  let target: EditorTab | undefined
                  if (event.key === 'ArrowRight')
                    target = snapshot.tabs[(index + 1) % snapshot.tabs.length]
                  if (event.key === 'ArrowLeft')
                    target =
                      snapshot.tabs[
                        (index - 1 + snapshot.tabs.length) %
                          snapshot.tabs.length
                      ]
                  if (event.key === 'Home') target = snapshot.tabs[0]
                  if (event.key === 'End') target = snapshot.tabs.at(-1)
                  if (target) {
                    event.preventDefault()
                    workspace.select(target.id)
                    buttons.current.get(target.id)?.focus()
                  }
                  if (event.key === 'Delete') {
                    event.preventDefault()
                    void workspace.requestCloseTab(tab.id)
                  }
                }}
              >
                {tabName(tab)}
                {dirty && <span aria-hidden="true"> •</span>}
              </button>
            )
          })}
        </div>
        <div className={styles.actions}>
          <button
            ref={newTabButton}
            disabled={locked}
            onClick={() => workspace.newDocument()}
          >
            New tab
          </button>
          {active && (
            <button
              disabled={locked}
              aria-label={`Close tab ${tabName(active)}`}
              title={`Close tab ${tabName(active)}`}
              onClick={() => void workspace.requestCloseTab(active.id)}
            >
              Close tab
            </button>
          )}
        </div>
      </div>
      <p id={`${prefix}-hint`} className={styles.hint}>
        Arrow keys switch tabs. Delete closes the selected tab.
      </p>
      {snapshot.notice && <p role="status">{snapshot.notice}</p>}
      {snapshot.tabs.map((tab) => (
        <section
          key={tab.id}
          id={`${prefix}-panel-${tab.id}`}
          className={styles.panel}
          role="tabpanel"
          aria-labelledby={`${prefix}-${tab.id}`}
          hidden={tab.id !== snapshot.activeId}
        >
          {tab.id === snapshot.activeId && (
            <DocumentPanel tab={tab} workspace={workspace} owner={owner} />
          )}
        </section>
      ))}
      {!active && (
        <p>No documents open. Create a new tab or open a file from Files.</p>
      )}
    </div>
  )
}
