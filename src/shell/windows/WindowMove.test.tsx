import { Profiler, StrictMode } from 'react'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { RuntimeProvider } from '../../app/RuntimeProvider'
import { Taskbar } from '../taskbar/Taskbar'
import { WindowLayer } from './WindowLayer'
import { firstApp, secondApp } from '../../test/fixtures'

// jsdom has no native dialog top-layer behavior; Chromium tests verify focus/inertness.
function mockDialogs() {
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
  return () => {
    for (const name of ['showModal', 'close']) {
      if (saved[name]) Object.defineProperty(prototype, name, saved[name])
      else Reflect.deleteProperty(prototype, name)
    }
  }
}

describe('window move integration', () => {
  it('keeps taskbar and app render counts unchanged through geometry updates', async () => {
    let firstRenders = 0
    let secondRenders = 0
    let taskbarCommits = 0
    const runtime = createBrowserRuntime([
      {
        manifest: firstApp,
        load: async () => ({
          default: () => {
            firstRenders++
            return <p>First content</p>
          },
        }),
      },
      {
        manifest: secondApp,
        load: async () => ({
          default: () => {
            secondRenders++
            return <p>Second content</p>
          },
        }),
      },
    ])
    const view = render(
      <StrictMode>
        <RuntimeProvider runtime={runtime}>
          <Profiler id="taskbar" onRender={() => taskbarCommits++}>
            <Taskbar />
          </Profiler>
          <WindowLayer />
        </RuntimeProvider>
      </StrictMode>,
    )
    try {
      await act(async () => {
        await runtime.launch(firstApp.id)
        await runtime.launch(secondApp.id)
      })
      const initial = [firstRenders, secondRenders, taskbarCommits]
      const id = runtime.windows.getState().ids[0]
      for (let i = 0; i < 50; i++)
        act(() =>
          runtime.moveWindow(
            id,
            { x: 50 + i, y: 60 },
            { width: 1000, height: 700 },
          ),
        )
      for (let i = 0; i < 50; i++)
        act(() =>
          runtime.resizeWindow(
            id,
            { x: 99, y: 60, width: 350 + i, height: 250 + i },
            { width: 1000, height: 700 },
          ),
        )
      expect([firstRenders, secondRenders, taskbarCommits]).toEqual(initial)
      expect(runtime.windows.getState().byId[id]?.bounds.x).toBe(99)
    } finally {
      view.unmount()
      runtime.dispose()
    }
  })
  it('previews keyboard moves, commits once, cancels without a write and returns focus', async () => {
    const restore = mockDialogs()
    const runtime = createBrowserRuntime()
    const view = render(
      <StrictMode>
        <BrowserOS runtime={runtime} />
      </StrictMode>,
    )
    const user = userEvent.setup()
    try {
      await user.click(
        screen.getByRole('button', { name: 'Open About BrowserOS' }),
      )
      const frame = await screen.findByRole('region', {
        name: 'About BrowserOS window',
      })
      const id = runtime.windows.getState().ids[0]
      const start = runtime.windows.getState().byId[id]!.bounds
      let writes = 0
      const unsubscribe = runtime.windows.subscribe(() => writes++)
      const actions = screen.getByRole('button', {
        name: 'Window actions for About BrowserOS',
      })
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: 'Move window' }))
      const dialog = await screen.findByRole('dialog', {
        name: 'Move About BrowserOS',
      })
      await user.click(within(dialog).getByRole('button', { name: 'Right' }))
      expect(frame.style.left).toBe(`${start.x + 10}px`)
      expect(runtime.windows.getState().byId[id]!.bounds).toBe(start)
      expect(writes).toBe(0)
      await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
      expect(writes).toBe(1)
      await waitFor(() => expect(actions).toHaveFocus())
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: 'Move window' }))
      const next = screen.getByRole('dialog')
      await user.click(within(next).getByRole('button', { name: 'Down' }))
      await user.click(within(next).getByRole('button', { name: 'Cancel' }))
      expect(writes).toBe(1)
      expect(frame.style.top).toBe(`${start.y}px`)
      expect(actions).toHaveFocus()
      unsubscribe()
    } finally {
      view.unmount()
      runtime.dispose()
      restore()
    }
  })
  it('previews keyboard resize without writes, enforces registry minimum and preserves app state', async () => {
    const restore = mockDialogs()
    const runtime = createBrowserRuntime()
    const view = render(
      <StrictMode>
        <BrowserOS runtime={runtime} />
      </StrictMode>,
    )
    const user = userEvent.setup()
    try {
      await user.click(
        screen.getByRole('button', { name: 'Open About BrowserOS' }),
      )
      const frame = await screen.findByRole('region', {
        name: 'About BrowserOS window',
      })
      const id = runtime.windows.getState().ids[0]
      const start = runtime.windows.getState().byId[id]!.bounds
      let writes = 0
      const unsubscribe = runtime.windows.subscribe(() => writes++)
      const actions = screen.getByRole('button', {
        name: 'Window actions for About BrowserOS',
      })
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: 'Resize window' }))
      let dialog = await screen.findByRole('dialog', {
        name: 'Resize About BrowserOS',
      })
      await user.click(within(dialog).getByRole('button', { name: 'Wider' }))
      expect(frame.style.width).toBe(`${start.width + 10}px`)
      expect(runtime.windows.getState().byId[id]!.bounds).toBe(start)
      expect(writes).toBe(0)
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(frame.style.width).toBe(`${start.width}px`)
      expect(writes).toBe(0)
      expect(actions).toHaveFocus()
      await user.click(actions)
      await user.click(screen.getByRole('menuitem', { name: 'Resize window' }))
      dialog = screen.getByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: 'Taller' }))
      await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
      expect(writes).toBe(1)
      expect(runtime.windows.getState().byId[id]!.bounds.height).toBe(
        start.height + 10,
      )
      act(() =>
        runtime.resizeWindow(
          id,
          { ...start, width: 1, height: 1 },
          { width: 1000, height: 700 },
        ),
      )
      expect(runtime.windows.getState().byId[id]!.bounds).toEqual({
        ...start,
        width: 280,
        height: 240,
      })
      expect(
        within(frame).getByText('A desktop, built for the browser.'),
      ).toBeInTheDocument()
      unsubscribe()
    } finally {
      view.unmount()
      runtime.dispose()
      restore()
    }
  })
})
