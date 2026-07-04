import { useId } from 'react'
import type { useDocumentControls } from '../text-document/useDocumentControls'
import type { EditorTab } from './workspace'
import type { EngineOwner } from './engine/owner'
import {
  codeLanguage,
  lineEnding,
  restoreLineEnding,
} from './engine/lineEndings'
import { useCodeMirror } from './useCodeMirror'
import { useEditorAppearance } from './useEditorAppearance'
import styles from './CodeSurface.module.css'
type Props = {
  tab: EditorTab
  owner: EngineOwner
  model: ReturnType<typeof useDocumentControls>
}
function RichCodeSurface({ tab, owner, model }: Props) {
  const dark = useEditorAppearance()
  const { host, textarea, phase, compositionStart, compositionEnd } =
    useCodeMirror(owner, tab, dark)
  const inputId = useId()
  const snapshot = model.snapshot
  if (snapshot.status !== 'ready') return null
  const baseline = lineEnding(snapshot.baseline)
  const separator = lineEnding(
    snapshot.buffer,
    baseline === 'mixed' ? '\n' : baseline,
  )
  const endingLabel = /[\r\n]/.test(snapshot.buffer)
    ? separator === '\r\n'
      ? 'CRLF'
      : separator === '\r'
        ? 'CR'
        : 'LF'
    : 'No line breaks'
  const ready = phase === 'ready'
  return (
    <div
      className={styles.surface}
      onKeyDown={model.onEditorKeyDown}
      onCompositionStart={model.onCompositionStart}
      onCompositionEnd={model.onCompositionEnd}
      onCompositionStartCapture={compositionStart}
      onCompositionEndCapture={compositionEnd}
    >
      {!ready && (
        <>
          <label htmlFor={inputId}>Code</label>
          <textarea
            id={inputId}
            ref={textarea}
            value={snapshot.buffer}
            maxLength={1048576}
            spellCheck={false}
            wrap="off"
            onChange={(event) =>
              model.edit(
                restoreLineEnding(
                  event.target.value,
                  separator === 'mixed' ? '\n' : separator,
                ),
              )
            }
          />
        </>
      )}
      {ready && <p className={styles.label}>Code</p>}
      <div ref={host} className={styles.host} hidden={!ready} />
      <p
        className={styles.hint}
        role={phase === 'failed' ? 'status' : undefined}
      >
        {phase === 'failed'
          ? 'Rich editor unavailable. Your text is kept in the plain editor.'
          : phase === 'loading'
            ? 'Loading editor. You can keep typing.'
            : `${codeLanguage(snapshot.name) === 'plain' ? 'Plain text' : codeLanguage(snapshot.name)} · ${endingLabel} · Tab moves focus`}
      </p>
    </div>
  )
}
export function CodeSurface(props: Props) {
  const id = useId()
  const snapshot = props.model.snapshot
  if (snapshot.status !== 'ready') return null
  if (lineEnding(snapshot.buffer) === 'mixed')
    return (
      <div
        className={styles.surface}
        onKeyDown={props.model.onEditorKeyDown}
        onCompositionStart={props.model.onCompositionStart}
        onCompositionEnd={props.model.onCompositionEnd}
      >
        <label htmlFor={id}>Code</label>
        <textarea
          id={id}
          value={snapshot.buffer}
          readOnly
          spellCheck={false}
          wrap="off"
        />
        <p role="status">
          This file has mixed line endings. Its original text is kept; convert
          to LF to edit.
        </p>
        <button
          onClick={() =>
            props.model.edit(restoreLineEnding(snapshot.buffer, '\n'))
          }
        >
          Convert line endings to LF
        </button>
      </div>
    )
  return <RichCodeSurface {...props} />
}
