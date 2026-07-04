import { StrictMode, useEffect } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { temporaryWorkspace } from '../../app/workspace'
import { createEditorWorkspace } from './workspace'
import { useEngineOwner } from './useEngineOwner'
import type { EngineOwner } from './engine/owner'
import type { EnginePool } from './engine/types'
const engine = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('./engine/load', () => ({
  loadEditorEngine: async () => ({ createEnginePool: engine.create }),
}))
it('does not dispose a live StrictMode owner; closes removed tabs and releases the pool on real unmount', async () => {
  const services = temporaryWorkspace()
  const workspace = createEditorWorkspace(services.vfs, services.refresh, null)
  workspace.start()
  const pool: EnginePool = { retain: vi.fn(), mount: vi.fn(), dispose: vi.fn() }
  engine.create.mockReturnValue(pool)
  let owner: EngineOwner | undefined
  function Harness() {
    const current = useEngineOwner(workspace)
    useEffect(() => {
      owner = current
      void current.get()
    }, [current])
    return null
  }
  const view = render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )
  try {
    await waitFor(() => expect(engine.create).toHaveBeenCalledTimes(1))
    expect(pool.dispose).not.toHaveBeenCalled()
    expect(await owner!.get()).toBe(pool)
    const tab = workspace.getSnapshot().tabs[0]
    await act(async () => {
      await workspace.requestCloseTab(tab.id)
    })
    expect(pool.retain).toHaveBeenLastCalledWith([])
    view.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(pool.dispose).toHaveBeenCalledTimes(1)
    await expect(owner!.get()).rejects.toThrow('closed')
  } finally {
    view.unmount()
    workspace.stop()
    services.dispose()
  }
})
