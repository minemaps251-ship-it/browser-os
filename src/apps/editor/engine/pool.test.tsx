import { afterEach, expect, it, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { undo, undoDepth } from '@codemirror/commands'
import { createEnginePool } from './codeMirror'
import type { EnginePool, EditorProjection } from './types'
const pools: EnginePool[] = []
afterEach(() => {
  pools.splice(0).forEach((pool) => pool.dispose())
  document.body.replaceChildren()
})
function fixture() {
  const pool = createEnginePool()
  pools.push(pool)
  pool.retain(['one', 'two'])
  const host = document.createElement('div')
  document.body.append(host)
  const initial: EditorProjection = {
    text: 'first\r\nsecond',
    separator: '\r\n',
    name: 'one.js',
    dark: false,
  }
  const callbacks = { edit: vi.fn(), fail: vi.fn() }
  const mount = (id: string, projection = initial) => {
    const handle = pool.mount(host, id, projection, callbacks)
    const view = EditorView.findFromDOM(
      host.querySelector<HTMLElement>('.cm-editor')!,
    )!
    return { handle, view }
  }
  return { pool, host, initial, callbacks, mount }
}
it('keeps history/cursor independently across tabs and preserves it on theme, rename and save projections', () => {
  const f = fixture()
  const one = f.mount('one')
  one.view.dispatch({
    changes: { from: 0, insert: 'edit ' },
    selection: { anchor: 3 },
  })
  const changed = { ...f.initial, text: 'edit first\r\nsecond' }
  expect(f.callbacks.edit).toHaveBeenLastCalledWith(changed.text)
  one.handle.sync({ ...changed, name: 'renamed.ts', dark: true })
  expect(undoDepth(one.view.state)).toBe(1)
  expect(one.handle.selection()).toEqual({ anchor: 3, head: 3 })
  one.handle.dispose()
  const two = f.mount('two', { ...f.initial, text: 'second tab' })
  two.view.dispatch({ changes: { from: 0, insert: 'two ' } })
  two.handle.dispose()
  const restored = f.mount('one', changed)
  expect(restored.handle.selection()).toEqual({ anchor: 3, head: 3 })
  expect(undo(restored.view)).toBe(true)
  expect(restored.view.state.sliceDoc()).toBe(f.initial.text)
  expect(f.callbacks.fail).not.toHaveBeenCalled()
})
it('external text resets stale undo without echo; removed tabs and disposed windows cannot retain history', () => {
  const f = fixture()
  const one = f.mount('one')
  one.view.dispatch({ changes: { from: 0, insert: 'edit ' } })
  f.callbacks.edit.mockClear()
  one.handle.sync({ ...f.initial, text: 'outside\r\ntext' })
  expect(undo(one.view)).toBe(false)
  expect(f.callbacks.edit).not.toHaveBeenCalled()
  f.pool.retain(['two'])
  expect(f.host.querySelector('.cm-editor')).toBeNull()
  expect(() => f.mount('one')).toThrow('closed')
  f.pool.retain(['one'])
  const reopened = f.mount('one')
  expect(undoDepth(reopened.view.state)).toBe(0)
  f.pool.dispose()
  f.pool.dispose()
  expect(f.host.querySelector('.cm-editor')).toBeNull()
  expect(() => f.mount('one')).toThrow('closed')
})
it('keeps CRLF preference across empty saves so a subsequent newline stays CRLF', () => {
  const f = fixture()
  const one = f.mount('one')
  one.view.dispatch({ changes: { from: 0, to: one.view.state.doc.length } })
  one.handle.sync({ ...f.initial, text: '', separator: '\n' })
  one.handle.dispose()
  const reopened = f.mount('one', { ...f.initial, text: '', separator: '\n' })
  reopened.view.dispatch({ changes: { from: 0, insert: 'a\r\nb' } })
  expect(reopened.view.state.sliceDoc()).toBe('a\r\nb')
  expect(f.callbacks.edit).toHaveBeenLastCalledWith('a\r\nb')
})
