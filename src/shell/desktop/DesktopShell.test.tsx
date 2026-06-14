import { StrictMode } from 'react'
import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import {
  createBrowserRuntime,
  type BrowserRuntime,
} from '../../app/createRuntime'
import { firstApp, secondApp } from '../../test/fixtures'
import type { AppRegistration } from '../../app/builtInApps'

const runtimes: BrowserRuntime[] = []
afterEach(() => {
  runtimes.splice(0).forEach((runtime) => runtime.dispose())
})
function mount(registrations?: readonly AppRegistration[]) {
  const runtime = createBrowserRuntime(registrations)
  runtimes.push(runtime)
  render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  return runtime
}

describe('Desktop Shell', () => {
  it('launches About through the registry, deduplicates, and closes back to the launcher', async () => {
    const user = userEvent.setup()
    const runtime = mount()
    const launcher = screen.getByRole('button', {
      name: 'Open About BrowserOS',
    })
    await user.click(launcher)
    const window = await screen.findByRole('region', {
      name: 'About BrowserOS window',
    })
    expect(
      within(window).getByText('A desktop, built for the browser.'),
    ).toBeInTheDocument()
    await waitFor(() => expect(window).toHaveFocus())
    await user.click(launcher)
    expect(
      screen.getAllByRole('region', { name: 'About BrowserOS window' }),
    ).toHaveLength(1)
    expect(runtime.listProcesses()).toHaveLength(1)
    await user.click(
      screen.getByRole('button', { name: 'Close About BrowserOS' }),
    )
    expect(
      screen.queryByRole('region', { name: 'About BrowserOS window' }),
    ).not.toBeInTheDocument()
    expect(launcher).toHaveFocus()
    expect(runtime.listProcesses()).toEqual([])
  })
  it('keeps the shell usable after a loader failure', async () => {
    const user = userEvent.setup()
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: () => <p>Recovered app</p> })
    const runtime = mount([{ manifest: firstApp, load }])
    await user.click(screen.getByRole('button', { name: 'Open First app' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open First app',
    )
    expect(runtime.listProcesses()).toEqual([])
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open First app' }))
    expect(await screen.findByText('Recovered app')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
  it('switches windows without resetting app local state and focuses the survivor on close', async () => {
    const user = userEvent.setup()
    const { useState } = await import('react')
    function Counter() {
      const [n, setN] = useState(0)
      return <button onClick={() => setN(n + 1)}>Value {n}</button>
    }
    const runtime = mount([
      { manifest: firstApp, load: async () => ({ default: Counter }) },
      {
        manifest: secondApp,
        load: async () => ({ default: () => <p>Second content</p> }),
      },
    ])
    await user.click(screen.getByRole('button', { name: 'Open First app' }))
    await user.click(await screen.findByRole('button', { name: 'Value 0' }))
    await user.click(screen.getByRole('button', { name: 'Open Second app' }))
    const second = await screen.findByRole('region', {
      name: 'Second app window',
    })
    await waitFor(() => expect(second).toHaveFocus())
    await user.click(
      within(
        screen.getByRole('navigation', { name: 'Running applications' }),
      ).getByRole('button', { name: 'First app' }),
    )
    expect(screen.getByRole('button', { name: 'Value 1' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close First app' }))
    await waitFor(() => expect(second).toHaveFocus())
    expect(runtime.listProcesses()).toHaveLength(1)
  })
  it('isolates an app render crash from the desktop', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const runtime = mount([
        {
          manifest: firstApp,
          load: async () => ({
            default: () => {
              throw new Error('render crash')
            },
          }),
        },
      ])
      await act(() => runtime.launch(firstApp.id))
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'application stopped',
      )
      expect(
        screen.getByRole('heading', { name: 'BrowserOS' }),
      ).toBeInTheDocument()
      expect(runtime.listProcesses()[0].status).toBe('crashed')
      await userEvent
        .setup()
        .click(screen.getByRole('button', { name: 'Close First app' }))
      expect(runtime.listProcesses()).toEqual([])
    } finally {
      consoleError.mockRestore()
    }
  })
})
