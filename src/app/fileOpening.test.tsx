import { act, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { BrowserOS } from './BrowserOS'
import { createBrowserRuntime } from './createRuntime'
import { builtInApps, type ApplicationProps } from './builtInApps'
import { firstApp, deferred } from '../test/fixtures'
import { ROOT_NODE_ID } from '../core/filesystem/policy'
import type { NodeId } from '../core/filesystem/types'
function Reader({ launchInput }: ApplicationProps) {
  return (
    <p>
      File ID: {launchInput.kind === 'file' ? launchInput.fileId : 'default'}
    </p>
  )
}
it('delivers independent file inputs to renderer instances and releases process content on close', async () => {
  const runtime = createBrowserRuntime([
    {
      manifest: {
        ...firstApp,
        fileAssociations: [{ mime: 'text/plain', default: true }],
      },
      load: async () => ({ default: Reader }),
    },
  ])
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    const ids: NodeId[] = []
    for (const name of ['one.txt', 'two.txt']) {
      const file = await runtime.vfs.createFile(ROOT_NODE_ID, name, {
        kind: 'text',
        encoding: 'utf-8',
        text: '',
      })
      if (!file.ok) throw new Error('Create failed')
      ids.push(file.value)
    }
    let first!: Awaited<ReturnType<typeof runtime.openFile>>
    await act(async () => {
      first = await runtime.openFile(ids[0])
      await runtime.openFile(ids[1])
    })
    expect(screen.getByText(`File ID: ${ids[0]}`)).toBeInTheDocument()
    expect(screen.getByText(`File ID: ${ids[1]}`)).toBeInTheDocument()
    if (!first.ok) throw new Error('Launch failed')
    const windowId = first.windowId
    act(() => runtime.requestCloseWindow(windowId))
    expect(runtime.getContent(first.processId)).toBeUndefined()
    expect(screen.queryByText(`File ID: ${ids[0]}`)).not.toBeInTheDocument()
    expect(screen.getByText(`File ID: ${ids[1]}`)).toBeInTheDocument()
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
it('opens from Files with keyboard and reports unsupported/deleted files without starting a fake app', async () => {
  const runtime = createBrowserRuntime(
    builtInApps.filter((entry) => !entry.manifest.fileAssociations?.length),
  )
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const file = await runtime.vfs.createFile(home.value, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!file.ok) throw new Error('Create failed')
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const entry = await screen.findByRole('button', {
      name: 'Select file note.txt',
    })
    entry.focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No default application',
    )
    expect(runtime.listProcesses()).toHaveLength(1)
    const original = runtime.openFile
    vi.spyOn(runtime, 'openFile').mockImplementationOnce(async (id) => {
      await runtime.vfs.remove(id, { recursive: false })
      return original(id)
    })
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'no longer available',
    )
    expect(runtime.listProcesses()).toHaveLength(1)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
it('opens the selected file through a declared handler and restores the same window on repetition', async () => {
  const runtime = createBrowserRuntime([
    ...builtInApps.filter((entry) => !entry.manifest.fileAssociations?.length),
    {
      manifest: {
        ...firstApp,
        fileAssociations: [{ mime: 'text/plain', default: true }],
      },
      load: async () => ({ default: Reader }),
    },
  ])
  const home = await runtime.vfs.resolve('/home/user', ROOT_NODE_ID)
  if (!home.ok) throw new Error('Missing home')
  const file = await runtime.vfs.createFile(home.value, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!file.ok) throw new Error('Create failed')
  const user = userEvent.setup()
  const view = render(<BrowserOS runtime={runtime} />)
  try {
    await user.click(screen.getByRole('button', { name: 'Open Files' }))
    const files = await screen.findByRole('region', { name: 'Files window' })
    await user.click(
      await within(files).findByRole('button', {
        name: 'Select file note.txt',
      }),
    )
    await user.click(within(files).getByRole('button', { name: 'Open' }))
    expect(
      await screen.findByText(`File ID: ${file.value}`),
    ).toBeInTheDocument()
    await user.click(within(files).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(runtime.listProcesses()).toHaveLength(2))
    expect(
      screen.getAllByRole('region', { name: 'First app window' }),
    ).toHaveLength(1)
  } finally {
    view.unmount()
    runtime.dispose()
  }
})
it('rolls back a file removed during handler loading and never resurrects after runtime disposal', async () => {
  const gate = deferred<{ default: typeof Reader }>()
  const runtime = createBrowserRuntime([
    {
      manifest: {
        ...firstApp,
        fileAssociations: [{ mime: 'text/plain', default: true }],
      },
      load: () => gate.promise,
    },
  ])
  const file = await runtime.vfs.createFile(ROOT_NODE_ID, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!file.ok) throw new Error('Create failed')
  try {
    const pending = runtime.openFile(file.value)
    await waitFor(() => expect(runtime.listProcesses()).toHaveLength(1))
    await runtime.vfs.remove(file.value, { recursive: false })
    gate.resolve({ default: Reader })
    expect(await pending).toMatchObject({ ok: false, code: 'LAUNCH_FAILED' })
    expect(runtime.listProcesses()).toHaveLength(0)
    runtime.dispose()
    expect(await runtime.openFile(file.value)).toMatchObject({
      ok: false,
      code: 'STOPPED',
    })
  } finally {
    runtime.dispose()
  }
})

it('does not create file renderer content when disposed during module loading', async () => {
  const gate = deferred<{ default: typeof Reader }>()
  const runtime = createBrowserRuntime([
    {
      manifest: {
        ...firstApp,
        fileAssociations: [{ mime: 'text/plain', default: true }],
      },
      load: () => gate.promise,
    },
  ])
  const file = await runtime.vfs.createFile(ROOT_NODE_ID, 'note.txt', {
    kind: 'text',
    encoding: 'utf-8',
    text: '',
  })
  if (!file.ok) throw new Error('Create failed')
  const pending = runtime.openFile(file.value)
  await waitFor(() => expect(runtime.listProcesses()).toHaveLength(1))
  const processId = runtime.listProcesses()[0].id
  runtime.dispose()
  gate.resolve({ default: Reader })
  expect(await pending).toMatchObject({ ok: false, code: 'STOPPED' })
  expect(runtime.getContent(processId)).toBeUndefined()
  expect(runtime.windows.getState().ids).toHaveLength(0)
})
