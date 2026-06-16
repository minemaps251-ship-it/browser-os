import { StrictMode, useState } from 'react'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import { createBrowserRuntime } from '../../app/createRuntime'
import { firstApp, secondApp } from '../../test/fixtures'

function StatefulApp() {
  const [value, setValue] = useState('')
  const [count, setCount] = useState(0)
  return (
    <>
      <input
        aria-label="Draft"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={() => setCount(count + 1)}>Count {count}</button>
    </>
  )
}

describe('minimize integration', () => {
  it('keeps app state/processes/bounds and remembered focus when restored from Taskbar', async () => {
    const runtime = createBrowserRuntime([
      { manifest: firstApp, load: async () => ({ default: StatefulApp }) },
      {
        manifest: secondApp,
        load: async () => ({ default: () => <p>Second content</p> }),
      },
    ])
    const view = render(
      <StrictMode>
        <BrowserOS runtime={runtime} />
      </StrictMode>,
    )
    const user = userEvent.setup()
    try {
      await user.click(screen.getByRole('button', { name: 'Open First app' }))
      const first = await screen.findByRole('region', {
        name: 'First app window',
      })
      await user.type(
        screen.getByRole('textbox', { name: 'Draft' }),
        'Unsaved draft',
      )
      await user.click(screen.getByRole('button', { name: 'Count 0' }))
      const id = runtime.windows.getState().ids[0]
      const bounds = runtime.windows.getState().byId[id]!.bounds
      await user.click(screen.getByRole('button', { name: 'Open Second app' }))
      await user.click(
        within(
          screen.getByRole('navigation', { name: 'Running applications' }),
        ).getByRole('button', { name: 'First app' }),
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Count 1' })).toHaveFocus(),
      )
      await user.click(
        screen.getByRole('button', { name: 'Minimize First app' }),
      )
      expect(first).not.toBeVisible()
      expect(first).toHaveAttribute('inert')
      expect(
        screen.queryByRole('textbox', { name: 'Draft' }),
      ).not.toBeInTheDocument()
      expect(
        screen.getByRole('region', { name: 'Second app window' }),
      ).toHaveFocus()
      expect(runtime.listProcesses()).toHaveLength(2)
      expect(runtime.windows.getState().byId[id]!.bounds).toBe(bounds)
      await user.click(
        screen.getByRole('button', { name: 'First app (minimized)' }),
      )
      expect(first).toBeVisible()
      expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue(
        'Unsaved draft',
      )
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Count 1' })).toHaveFocus(),
      )
    } finally {
      view.unmount()
      runtime.dispose()
    }
  })
  it('restores a singleton via launcher and ignores duplicate minimize/restore without creating a process', async () => {
    const runtime = createBrowserRuntime()
    const view = render(
      <StrictMode>
        <BrowserOS runtime={runtime} />
      </StrictMode>,
    )
    const user = userEvent.setup()
    try {
      const launcher = screen.getByRole('button', {
        name: 'Open About BrowserOS',
      })
      await user.click(launcher)
      const frame = await screen.findByRole('region', {
        name: 'About BrowserOS window',
      })
      const id = runtime.windows.getState().ids[0]
      const pid = runtime.listProcesses()[0].id
      await user.click(
        screen.getByRole('button', { name: 'Minimize About BrowserOS' }),
      )
      expect(frame).not.toBeVisible()
      expect(launcher).toHaveFocus()
      act(() => runtime.minimizeWindow(id))
      expect(runtime.windows.getState().focusedId).toBeNull()
      await user.click(launcher)
      expect(frame).toBeVisible()
      expect(runtime.windows.getState().ids).toEqual([id])
      expect(runtime.listProcesses()[0].id).toBe(pid)
      act(() => runtime.restoreWindow(id))
      expect(runtime.listProcesses()).toHaveLength(1)
      await user.click(
        screen.getByRole('button', { name: 'Close About BrowserOS' }),
      )
      expect(runtime.listProcesses()).toEqual([])
    } finally {
      view.unmount()
      runtime.dispose()
    }
  })
})
