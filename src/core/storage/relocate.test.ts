import { expect, it, vi } from 'vitest'
import { createIndexedDbRelocation } from './relocate'
import type { DatabaseConnection } from './types'
import type { NodeId } from '../filesystem/types'
it.each([
  [new DOMException('closed', 'InvalidStateError'), 'STORAGE_UNAVAILABLE'],
  [new DOMException('full', 'QuotaExceededError'), 'QUOTA'],
])(
  'maps relocation transaction-opening errors without events: %s',
  async (error, code) => {
    const transaction = vi.fn(() => {
        throw error
      }),
      emit = vi.fn(),
      now = vi.fn(() => 42)
    const connection = {
      database: { transaction },
      closed: false,
      close: vi.fn(),
    } as unknown as DatabaseConnection
    const repository = createIndexedDbRelocation(
      connection,
      { now, createOperationId: () => 'operation' },
      emit,
    )
    for (const result of [
      await repository.rename('source' as NodeId, 'name'),
      await repository.move('source' as NodeId, 'parent' as NodeId),
    ])
      expect(result).toMatchObject({
        ok: false,
        error: { code, nodeId: 'source' },
      })
    expect(now).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  },
)
