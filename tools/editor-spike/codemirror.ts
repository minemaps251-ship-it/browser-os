import { EditorState, Compartment } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
} from '@codemirror/view'
import {
  history,
  historyKeymap,
  defaultKeymap,
  undo,
} from '@codemirror/commands'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { javascript } from '@codemirror/lang-javascript'
import { searchKeymap, openSearchPanel } from '@codemirror/search'
import type { EditorHandle, EditorOptions } from './contracts'
export function mount(
  parent: HTMLElement,
  options: EditorOptions,
): EditorHandle {
  const appearance = new Compartment()
  let disposed = false
  const theme = (dark: boolean) =>
    EditorView.theme(
      {
        '&': { color: 'var(--text)', backgroundColor: 'var(--surface)' },
        '.cm-content': { fontFamily: 'monospace', minHeight: '240px' },
        '.cm-scroller': { overflow: 'auto', maxHeight: '360px' },
        '.cm-gutters': {
          color: 'var(--muted)',
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--line)',
        },
        '&.cm-focused': { outline: '2px solid var(--focus)' },
      },
      { dark },
    )
  const state = (text: string, dark: boolean) =>
    EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        javascript({ typescript: true }),
        syntaxHighlighting(defaultHighlightStyle),
        EditorView.contentAttributes.of({
          'aria-label': 'Code',
          spellcheck: 'false',
        }),
        appearance.of(theme(dark)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString())
        }),
      ],
    })
  let dark = options.dark
  const view = new EditorView({ state: state(options.text, dark), parent })
  return {
    read: () => view.state.doc.toString(),
    // Explicit external reload replaces projection and clears stale undo history.
    replace: (text) => view.setState(state(text, dark)),
    focus: () => view.focus(),
    theme: (value) => {
      dark = value
      view.dispatch({ effects: appearance.reconfigure(theme(value)) })
    },
    undo: () => {
      undo(view)
    },
    find: () => {
      openSearchPanel(view)
    },
    diagnostics: async () => null,
    dispose: () => {
      if (!disposed) {
        disposed = true
        view.destroy()
      }
    },
    liveModels: () => (disposed ? 0 : 1),
    sharedModels: () => 0,
  }
}
