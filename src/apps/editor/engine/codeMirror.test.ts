import { expect, it, vi } from 'vitest'
import { Compartment, type Transaction } from '@codemirror/state'
import { undo, redo, undoDepth } from '@codemirror/commands'
import {
  javascriptLanguage,
  typescriptLanguage,
} from '@codemirror/lang-javascript'
import { createDocumentState } from './codeMirror'
import type { EditorProjection } from './types'
const initial: EditorProjection = {
  text: 'const a = 1;\r\nconst b = 2;',
  name: 'source.ts',
  dark: false,
  separator: '\r\n',
}
it('retains CRLF through edits, history and reconfiguration without echoing external state', () => {
  const theme = new Compartment(),
    language = new Compartment()
  const callbacks = { edit: vi.fn(), fail: vi.fn() }
  let state = createDocumentState(initial, theme, language, callbacks)
  const target = {
    get state() {
      return state
    },
    dispatch(transaction: Transaction) {
      state = transaction.state
    },
  }
  expect(state.sliceDoc()).toBe(initial.text)
  expect(typescriptLanguage.isActiveAt(state, 0)).toBe(true)
  state = state.update({
    changes: { from: state.doc.length, insert: '\r\n// hello' },
    selection: { anchor: 5 },
  }).state
  expect(state.sliceDoc()).toBe(initial.text + '\r\n// hello')
  expect(undoDepth(state)).toBe(1)
  state = state.update({
    effects: [theme.reconfigure([]), language.reconfigure(javascriptLanguage)],
  }).state
  expect(state.selection.main.anchor).toBe(5)
  expect(javascriptLanguage.isActiveAt(state, 0)).toBe(true)
  expect(undo(target)).toBe(true)
  expect(state.sliceDoc()).toBe(initial.text)
  expect(redo(target)).toBe(true)
  expect(state.sliceDoc()).toBe(initial.text + '\r\n// hello')
  state = createDocumentState(
    { ...initial, text: 'external\r\nreplacement' },
    theme,
    language,
    callbacks,
  )
  expect(undo(target)).toBe(false)
  expect(state.sliceDoc()).toBe('external\r\nreplacement')
  expect(callbacks.edit).not.toHaveBeenCalled()
})
it('supports CR and LF documents and plain text without a JS grammar', () => {
  for (const separator of ['\n', '\r'] as const) {
    const state = createDocumentState(
      { ...initial, text: `a${separator}b`, separator, name: 'a.txt' },
      new Compartment(),
      new Compartment(),
      { edit: vi.fn(), fail: vi.fn() },
    )
    expect(state.doc.lines).toBe(2)
    expect(state.sliceDoc()).toBe(`a${separator}b`)
    expect(javascriptLanguage.isActiveAt(state, 0)).toBe(false)
  }
})
