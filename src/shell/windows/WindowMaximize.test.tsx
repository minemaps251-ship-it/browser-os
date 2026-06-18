import { StrictMode, useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { aboutManifest } from '../../apps/about/manifest'

it('preserves app state/process and cancels keyboard interaction on external maximize', async () => {
  function App() {
    const [draft, setDraft] = useState('')
    return (
      <input
        aria-label="Draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
    )
  }
  // jsdom lacks native dialog methods; browser tests cover real modal behavior.
  const prototype = HTMLDialogElement.prototype
  const saved = Object.getOwnPropertyDescriptors(prototype)
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
  const runtime = createBrowserRuntime([
    { manifest: aboutManifest, load: async () => ({ default: App }) },
  ])
  const { unmount } = render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  try {
    const user = userEvent.setup()
    await user.click(
      screen.getByRole('button', { name: 'Open About BrowserOS' }),
    )
    const input = await screen.findByRole('textbox', { name: 'Draft' })
    await user.type(input, 'Saved local draft')
    const id = runtime.windows.getState().ids[0]
    const process = runtime.listProcesses()[0]
    const initial = runtime.windows.getState().byId[id]!.bounds
    await user.click(
      screen.getByRole('button', {
        name: 'Window actions for About BrowserOS',
      }),
    )
    await user.click(screen.getByRole('menuitem', { name: 'Move window' }))
    await user.keyboard('{ArrowRight}')
    act(() => runtime.maximizeWindow(id))
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(runtime.windows.getState().byId[id]?.placement).toEqual({
      kind: 'maximized',
      restoreBounds: initial,
    })
    await user.click(
      screen.getByRole('button', { name: 'Minimize About BrowserOS' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'About BrowserOS (minimized)' }),
    )
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue(
      'Saved local draft',
    )
    await user.click(
      screen.getByRole('button', { name: 'Restore size of About BrowserOS' }),
    )
    expect(runtime.windows.getState().byId[id]?.bounds).toEqual(initial)
    expect(runtime.listProcesses()).toEqual([process])
  } finally {
    unmount()
    runtime.dispose()
    for (const name of ['showModal', 'close']) {
      if (saved[name]) Object.defineProperty(prototype, name, saved[name])
      else Reflect.deleteProperty(prototype, name)
    }
  }
})
