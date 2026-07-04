// Existing session/UI contracts also exercise the native fallback.
import { StrictMode } from 'react'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { editorManifest } from './manifest'

it('isolates Editor and Notes buffers, preserves conflicts/deleted text, and restores the current file window', async () => {
  const runtime = createBrowserRuntime()
  const file = await runtime.vfs.createFile(ROOT_NODE_ID, 'source.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '<script>literal()</script>',
  })
  if (!file.ok) throw new Error('Create failed')
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  const user = userEvent.setup()
  try {
    await act(async () => {
      await runtime.openFile(file.value, editorManifest.id)
    })
    const editor = await screen.findByRole('region', {
      name: 'Code Editor window',
    })
    const code = await within(editor).findByRole('textbox', { name: 'Code' })
    expect(code).toHaveValue('<script>literal()</script>')
    expect(editor.querySelector('script')).toBeNull()
    expect(code).toHaveAttribute('wrap', 'off')
    await act(async () => {
      await runtime.openFile(file.value)
    })
    const notes = await screen.findByRole('region', { name: 'Notes window' })
    const text = await within(notes).findByRole('textbox', { name: 'Text' })
    await user.clear(code)
    await user.type(code, 'editor draft')
    expect(text).toHaveValue('<script>literal()</script>')
    await user.clear(text)
    await user.type(text, 'notes saved')
    await user.click(within(notes).getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(
        within(editor).getByRole('button', {
          name: 'Discard edits and reload',
        }),
      ).toBeVisible(),
    )
    expect(code).toHaveValue('editor draft')
    expect(within(editor).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(
      within(editor).getByRole('button', { name: 'Discard edits and reload' }),
    )
    await waitFor(() => expect(code).toHaveValue('notes saved'))
    await user.type(code, ' latest')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() =>
      expect(
        within(editor).getByRole('button', { name: 'Save' }),
      ).toBeDisabled(),
    )
    expect(await runtime.vfs.readFile(file.value)).toMatchObject({
      ok: true,
      value: { content: { text: 'notes saved latest' } },
    })
    await act(async () => {
      await runtime.openFile(file.value, editorManifest.id)
    })
    expect(
      screen.getAllByRole('region', { name: 'Code Editor window' }),
    ).toHaveLength(1)
    await user.type(code, ' retained')
    await act(async () => {
      await runtime.vfs.remove(file.value, { recursive: false })
    })
    await waitFor(() =>
      expect(
        within(editor).getByRole('button', { name: 'Save' }),
      ).toBeDisabled(),
    )
    expect(code).toHaveValue('notes saved latest retained')
    expect(
      within(editor).getByRole('button', { name: 'Save as' }),
    ).toBeEnabled()
  } finally {
    view.unmount()
    act(() => runtime.dispose())
  }
})

vi.mock('./engine/load', () => ({
  loadEditorEngine: () =>
    Promise.reject(new Error('Unavailable in fallback fixture')),
}))
