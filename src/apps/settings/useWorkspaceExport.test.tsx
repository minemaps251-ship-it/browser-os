import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { deferred } from '../../test/fixtures'
import type { ExportArtifact, ExportResult } from '../../core/export/types'
import { useWorkspaceExport } from './useWorkspaceExport'
const artifact: ExportArtifact = {
  json: '{"version":1}',
  filename: 'workspace.json',
  byteLength: 13,
  fileCount: 1,
  folderCount: 6,
}
afterEach(() => vi.restoreAllMocks())
function urls() {
  const create = vi.fn(() => 'blob:copy')
  const revoke = vi.fn()
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create
      static revokeObjectURL = revoke
    },
  )
  return { create, revoke }
}
afterEach(() => vi.unstubAllGlobals())
function Harness({
  prepare,
}: {
  prepare: () => Promise<ExportResult<ExportArtifact>>
}) {
  const { state, prepareCopy } = useWorkspaceExport(prepare)
  return (
    <>
      <button onClick={() => void prepareCopy()}>Prepare</button>
      <output>{state.phase}</output>
      {state.phase === 'ready' && (
        <a href={state.url} download={state.artifact.filename}>
          Download
        </a>
      )}
    </>
  )
}
it('deduplicates clicks, offers a native download and releases each URL on reprepare/unmount under StrictMode', async () => {
  const { create, revoke } = urls()
  const pending = deferred<ExportResult<ExportArtifact>>()
  const prepare = vi.fn(() => pending.promise)
  const view = render(
    <StrictMode>
      <Harness prepare={prepare} />
    </StrictMode>,
  )
  fireEvent.click(screen.getByRole('button'))
  fireEvent.click(screen.getByRole('button'))
  expect(prepare).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('busy')
  await act(async () => pending.resolve({ ok: true, value: artifact }))
  expect(screen.getByRole('link')).toHaveAttribute(
    'download',
    artifact.filename,
  )
  expect(create).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
  expect(revoke).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(revoke).toHaveBeenCalledTimes(2)
})
it('does not allocate a Blob URL after Settings has unmounted', async () => {
  const { create } = urls()
  const pending = deferred<ExportResult<ExportArtifact>>()
  const view = render(<Harness prepare={() => pending.promise} />)
  fireEvent.click(screen.getByRole('button'))
  view.unmount()
  await act(async () => pending.resolve({ ok: true, value: artifact }))
  expect(create).not.toHaveBeenCalled()
})
it('supports retry after read failure and allocation failure without leaving stale download URLs', async () => {
  const { create, revoke } = urls()
  const prepare = vi
    .fn<() => Promise<ExportResult<ExportArtifact>>>()
    .mockResolvedValueOnce({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'Retry' },
    })
    .mockResolvedValue({ ok: true, value: artifact })
  render(<Harness prepare={prepare} />)
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('error'),
  )
  expect(screen.queryByRole('link')).toBeNull()
  create.mockImplementationOnce(() => {
    throw new Error('Unavailable')
  })
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2))
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('error'),
  )
  fireEvent.click(screen.getByRole('button'))
  await screen.findByRole('link')
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1))
})
