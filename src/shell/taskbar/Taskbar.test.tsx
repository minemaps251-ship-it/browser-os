import { StrictMode } from 'react'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { BrowserOS } from '../../app/BrowserOS'
import {
  createBrowserRuntime,
  type BrowserRuntime,
} from '../../app/createRuntime'
import { aboutManifest } from '../../apps/about/manifest'
import { firstApp } from '../../test/fixtures'

const runtimes: BrowserRuntime[] = []
afterEach(() => runtimes.splice(0).forEach((runtime) => runtime.dispose()))

it('keeps its pinned app through launch, minimize, restore and close without duplicate processes', async () => {
  const runtime = createBrowserRuntime()
  runtimes.push(runtime)
  render(
    <StrictMode>
      <BrowserOS runtime={runtime} />
    </StrictMode>,
  )
  const user = userEvent.setup()
  const dock = screen.getByRole('navigation', { name: 'Running applications' })
  const icon = within(dock).getByRole('button', { name: 'About BrowserOS' })
  expect(icon).toHaveAttribute('data-running', 'false')
  await user.click(icon)
  const window = await screen.findByRole('region', {
    name: 'About BrowserOS window',
  })
  await waitFor(() => expect(window).toHaveFocus())
  const process = runtime.listProcesses()[0]
  await user.click(icon)
  expect(runtime.listProcesses()).toEqual([process])
  await user.click(
    screen.getByRole('button', { name: 'Minimize About BrowserOS' }),
  )
  expect(icon).toHaveAccessibleName('About BrowserOS (minimized)')
  await user.click(icon)
  expect(runtime.listProcesses()).toEqual([process])
  expect(window).toHaveFocus()
  await user.click(
    screen.getByRole('button', { name: 'Close About BrowserOS' }),
  )
  expect(icon).toBeVisible()
  expect(icon).toHaveAttribute('data-running', 'false')
  expect(runtime.listProcesses()).toEqual([])
})

it('reports a pinned loader failure and allows retry', async () => {
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ default: () => <p>Recovered</p> })
  const runtime = createBrowserRuntime([{ manifest: aboutManifest, load }])
  runtimes.push(runtime)
  render(<BrowserOS runtime={runtime} />)
  const user = userEvent.setup()
  const icon = within(
    screen.getByRole('navigation', { name: 'Running applications' }),
  ).getByRole('button', { name: 'About BrowserOS' })
  await user.click(icon)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not open About BrowserOS',
  )
  expect(icon).toBeEnabled()
  expect(runtime.listProcesses()).toEqual([])
  await user.click(icon)
  expect(await screen.findByText('Recovered')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('retains a separate Dock item for every multiple-instance window', async () => {
  const runtime = createBrowserRuntime([
    {
      manifest: firstApp,
      load: async () => ({ default: () => <p>Content</p> }),
    },
  ])
  runtimes.push(runtime)
  render(<BrowserOS runtime={runtime} />)
  const user = userEvent.setup()
  const launcher = screen.getByRole('button', { name: 'Open First app' })
  await user.click(launcher)
  await screen.findByRole('region', { name: 'First app window' })
  await user.click(launcher)
  const dock = screen.getByRole('navigation', { name: 'Running applications' })
  await waitFor(() =>
    expect(
      within(dock).getAllByRole('button', { name: 'First app' }),
    ).toHaveLength(2),
  )
  await user.click(
    within(dock).getAllByRole('button', { name: 'First app' })[0],
  )
  expect(runtime.windows.getState().focusedId).toBe(
    runtime.windows.getState().ids[0],
  )
})
