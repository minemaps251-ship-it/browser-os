import { StrictMode } from 'react'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { ROOT_NODE_ID } from '../../core/filesystem/policy'
import { editorManifest } from './manifest'
let restore: () => void
beforeEach(() => {
  const prototype = HTMLDialogElement.prototype
  const descriptors = Object.getOwnPropertyDescriptors(prototype)
  Object.defineProperty(prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
  restore = () => {
    for (const name of ['showModal', 'close']) {
      if (descriptors[name])
        Object.defineProperty(prototype, name, descriptors[name])
      else Reflect.deleteProperty(prototype, name)
    }
  }
})
afterEach(() => restore())
async function fixture() {
  const runtime = createBrowserRuntime()
  const create = async (name: string) => {
    const result = await runtime.vfs.createFile(ROOT_NODE_ID, name, {
      kind: 'text',
      encoding: 'utf-8',
      text: name,
    })
    if (!result.ok) throw new Error('Create failed')
    return result.value
  }
  const one = await create('one.txt'),
    two = await create('two.txt')
  const view = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  await act(async () => {
    await Promise.all([
      runtime.openFile(one, editorManifest.id),
      runtime.openFile(two, editorManifest.id),
    ])
  })
  const editor = await screen.findByRole('region', {
    name: 'Code Editor window',
  })
  await within(editor).findByRole('tab', { name: 'two.txt' })
  const user = userEvent.setup()
  return {
    runtime,
    view,
    editor,
    user,
    one,
    two,
    stop: () => {
      view.unmount()
      act(() => runtime.dispose())
    },
  }
}
it('delivers cold opens to one window, isolates drafts and offers roving keyboard tabs with close focus', async () => {
  const { editor, user, stop, runtime, one, two } = await fixture()
  try {
    expect(
      screen.getAllByRole('region', { name: 'Code Editor window' }),
    ).toHaveLength(1)
    const first = within(editor).getByRole('tab', { name: 'one.txt' })
    const second = within(editor).getByRole('tab', { name: 'two.txt' })
    await user.click(first)
    let code = within(editor).getByRole('textbox', { name: 'Code' })
    await user.clear(code)
    await user.type(code, 'first draft')
    await user.click(second)
    code = within(editor).getByRole('textbox', { name: 'Code' })
    expect(code).toHaveValue('two.txt')
    await user.clear(code)
    await user.type(code, 'second saved')
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() =>
      expect(
        within(editor).getByRole('button', { name: 'Save' }),
      ).toBeDisabled(),
    )
    expect(await runtime.vfs.readFile(one)).toMatchObject({
      ok: true,
      value: { content: { text: 'one.txt' } },
    })
    expect(await runtime.vfs.readFile(two)).toMatchObject({
      ok: true,
      value: { content: { text: 'second saved' } },
    })
    await user.click(second)
    await user.keyboard('{ArrowLeft}')
    expect(first).toHaveFocus()
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(within(editor).getByRole('textbox', { name: 'Code' })).toHaveValue(
      'first draft',
    )
    await user.keyboard('{End}')
    expect(second).toHaveFocus()
    await user.keyboard('{Delete}')
    await waitFor(() => expect(first).toHaveFocus())
    expect(
      within(editor).queryByRole('tab', { name: 'two.txt' }),
    ).not.toBeInTheDocument()
    expect(first).toHaveAccessibleName('one.txt, unsaved changes')
  } finally {
    stop()
  }
})
it('preserves all drafts on aggregate Cancel and warns on unload for inactive dirty tabs', async () => {
  const { editor, user, stop } = await fixture()
  try {
    await user.click(within(editor).getByRole('tab', { name: 'one.txt' }))
    await user.type(
      within(editor).getByRole('textbox', { name: 'Code' }),
      ' first draft',
    )
    await user.click(within(editor).getByRole('tab', { name: 'two.txt' }))
    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
    await user.type(
      within(editor).getByRole('textbox', { name: 'Code' }),
      ' second draft',
    )
    await user.click(
      within(editor).getByRole('button', { name: 'Close Code Editor' }),
    )
    let dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    expect(within(dialog).getByText(/one.txt/)).toBeInTheDocument()
    await user.click(
      within(dialog).getByRole('button', { name: 'Discard changes' }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: 'Unsaved changes' }),
      ).toHaveTextContent('two.txt'),
    )
    dialog = screen.getByRole('dialog', { name: 'Unsaved changes' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await user.click(
      within(editor).getByRole('tab', { name: 'one.txt, unsaved changes' }),
    )
    expect(within(editor).getByRole('textbox', { name: 'Code' })).toHaveValue(
      'one.txt first draft',
    )
  } finally {
    stop()
  }
  const afterUnload = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(afterUnload)
  expect(afterUnload.defaultPrevented).toBe(false)
})
