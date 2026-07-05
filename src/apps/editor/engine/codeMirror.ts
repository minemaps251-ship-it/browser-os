import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from '@codemirror/view'
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'
import { searchKeymap } from '@codemirror/search'
import { codeLanguage } from './lineEndings'
import type {
  EnginePool,
  EngineHandle,
  EditorProjection,
  EditorSelection as SelectionSeed,
} from './types'

function appearance(dark: boolean) {
  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: dark ? '#c5a3ff' : '#6740a0' },
    { tag: [tags.string, tags.regexp], color: dark ? '#9dd5b3' : '#286348' },
    {
      tag: [tags.number, tags.bool, tags.null],
      color: dark ? '#efbb86' : '#8c4b1e',
    },
    {
      tag: tags.comment,
      color: dark ? '#aab6c6' : '#576473',
      fontStyle: 'italic',
    },
    {
      tag: [tags.typeName, tags.className],
      color: dark ? '#9ccbf6' : '#285d89',
    },
  ])
  return [
    EditorView.theme(
      {
        '&': {
          backgroundColor: 'var(--surface)',
          color: 'var(--text)',
          fontSize: '13px',
          flex: '1',
          minHeight: '0',
        },
        '.cm-content': {
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          minHeight: '100%',
          padding: '10px 0',
          caretColor: 'var(--text)',
        },
        '.cm-scroller': { overflow: 'auto', minHeight: '0', flex: '1' },
        '.cm-gutters': {
          color: 'var(--muted)',
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--line)',
        },
        '.cm-activeLine, .cm-activeLineGutter': {
          backgroundColor: 'var(--window-titlebar)',
        },
        '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
          backgroundColor: 'var(--editor-selection)',
        },
        '.cm-searchMatch, .cm-searchMatch-selected': {
          backgroundColor: 'var(--editor-match)',
          color: 'var(--editor-match-text)',
          outline: '1px solid var(--accent)',
        },
        '.cm-search': {
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '6px',
          padding: '8px',
        },
        '.cm-search br': { display: 'none' },
        '.cm-search .cm-textfield': {
          flex: '1 1 130px',
          minWidth: '0',
          width: '130px',
          fontSize: '13px',
        },
        '.cm-search button': {
          minHeight: 'var(--control-height)',
          padding: '4px 8px',
          border: '1px solid var(--control-border)',
          borderRadius: 'var(--radius-small)',
          background: 'var(--surface-subtle)',
          color: 'var(--text)',
          fontSize: '12px',
        },
        '.cm-search button:hover': { background: 'var(--surface-hover)' },
        '.cm-panel.cm-search button[name=close]': {
          position: 'static',
          minWidth: 'var(--control-height)',
          marginLeft: 'auto',
        },
        '.cm-cursor': { borderLeftColor: 'var(--text)' },
        '.cm-search input[type=checkbox]': {
          width: '16px',
          height: '16px',
          minHeight: '0',
          flex: '0 0 auto',
          display: 'inline-block',
          padding: '0',
          margin: '0 4px 0 0',
        },
        '.cm-search label': {
          display: 'inline-flex',
          alignItems: 'center',
          margin: '0',
          minHeight: 'var(--control-height)',
          fontSize: '12px',
        },
        '.cm-panels': {
          maxHeight: '50%',
          overflowY: 'auto',
          backgroundColor: 'var(--surface)',
          color: 'var(--text)',
        },
        '&.cm-focused': {
          outline: '2px solid var(--text)',
          outlineOffset: '2px',
        },
      },
      { dark },
    ),
    syntaxHighlighting(highlight),
  ]
}
function grammar(name: string) {
  const language = codeLanguage(name)
  return language === 'plain'
    ? []
    : javascript({
        typescript: language === 'typescript' || language === 'tsx',
        jsx: language === 'jsx' || language === 'tsx',
      })
}
export function createDocumentState(
  projection: EditorProjection,
  theme: Compartment,
  language: Compartment,
  callbacks: { edit(text: string): void; fail(): void },
) {
  return EditorState.create({
    doc: projection.text,
    extensions: [
      EditorState.lineSeparator.of(projection.separator),
      EditorState.tabSize.of(2),
      lineNumbers(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      theme.of(appearance(projection.dark)),
      language.of(grammar(projection.name)),
      EditorView.contentAttributes.of({
        'aria-label': 'Code',
        spellcheck: 'false',
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) callbacks.edit(update.state.sliceDoc())
      }),
      EditorView.exceptionSink.of(() => callbacks.fail()),
    ],
  })
}
export function createEnginePool(): EnginePool {
  type Entry = {
    state: EditorState
    theme: Compartment
    language: Compartment
    projection: EditorProjection
    scrollTop: number
    scrollLeft: number
  }
  const entries = new Map<string, Entry>()
  let allowed = new Set<string>()
  let active: { id: string; handle: EngineHandle } | null = null
  let disposed = false
  // State listeners use a mutable binding so cached history never retains old React closures.
  const bindings = new Map<string, { edit(text: string): void; fail(): void }>()
  function state(projection: EditorProjection, entry: Entry, id: string) {
    return createDocumentState(projection, entry.theme, entry.language, {
      edit: (text) => bindings.get(id)?.edit(text),
      fail: () => bindings.get(id)?.fail(),
    })
  }
  return {
    retain(ids) {
      allowed = new Set(ids)
      if (active && !allowed.has(active.id)) active.handle.dispose()
      for (const id of entries.keys())
        if (!allowed.has(id)) {
          entries.delete(id)
          bindings.delete(id)
        }
    },
    mount(host, id, projection, callbacks, selection?: SelectionSeed) {
      if (disposed || !allowed.has(id)) throw new Error('Document closed')
      active?.handle.dispose()
      let entry = entries.get(id)
      if (entry && !/[\r\n]/.test(projection.text))
        projection = { ...projection, separator: entry.projection.separator }
      if (!entry) {
        const theme = new Compartment(),
          language = new Compartment()
        entry = {
          state: createDocumentState(projection, theme, language, {
            edit: (text) => bindings.get(id)?.edit(text),
            fail: () => bindings.get(id)?.fail(),
          }),
          theme,
          language,
          projection,
          scrollTop: 0,
          scrollLeft: 0,
        }
        entries.set(id, entry)
      } else if (
        entry.projection.text !== projection.text ||
        entry.projection.separator !== projection.separator
      ) {
        entry.state = state(projection, entry, id)
        entry.projection = projection
      }
      const record = entry
      bindings.set(id, {
        edit: (text) => {
          record.projection = { ...record.projection, text }
          callbacks.edit(text)
        },
        fail: callbacks.fail,
      })
      if (selection)
        record.state = record.state.update({
          selection: EditorSelection.range(
            Math.min(selection.anchor, record.state.doc.length),
            Math.min(selection.head, record.state.doc.length),
          ),
        }).state
      const view = new EditorView({ state: record.state, parent: host })
      view.scrollDOM.scrollTop = record.scrollTop
      view.scrollDOM.scrollLeft = record.scrollLeft
      let released = false
      const handle: EngineHandle = {
        sync(next) {
          if (released) return
          if (!/[\r\n]/.test(next.text))
            next = { ...next, separator: record.projection.separator }
          if (
            record.projection.text !== next.text ||
            record.projection.separator !== next.separator
          ) {
            view.setState(state(next, record, id))
          } else {
            const effects = []
            if (record.projection.dark !== next.dark)
              effects.push(record.theme.reconfigure(appearance(next.dark)))
            if (
              codeLanguage(record.projection.name) !== codeLanguage(next.name)
            )
              effects.push(record.language.reconfigure(grammar(next.name)))
            if (effects.length) view.dispatch({ effects })
          }
          record.projection = next
          record.state = view.state
        },
        focus: () => {
          if (!released) view.focus()
        },
        selection: () => ({
          anchor: view.state.selection.main.anchor,
          head: view.state.selection.main.head,
        }),
        dispose() {
          if (released) return
          released = true
          if (allowed.has(id) && !disposed) {
            record.state = view.state
            record.scrollTop = view.scrollDOM.scrollTop
            record.scrollLeft = view.scrollDOM.scrollLeft
          }
          bindings.delete(id)
          view.destroy()
          if (active?.handle === handle) active = null
        },
      }
      active = { id, handle }
      // Cached states also need appearance/grammar reconciliation on reactivation.
      try {
        handle.sync(projection)
        return handle
      } catch (error) {
        handle.dispose()
        throw error
      }
    },
    dispose() {
      disposed = true
      active?.handle.dispose()
      entries.clear()
      bindings.clear()
      allowed.clear()
    },
  }
}
