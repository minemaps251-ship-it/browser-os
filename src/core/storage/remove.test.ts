import { expect, it, vi } from 'vitest'
import { createIndexedDbRemove } from './remove'
import type { DatabaseConnection } from './types'
import type { NodeId, RemoveOptions } from '../filesystem/types'
it.each([
  [new DOMException('closed', 'InvalidStateError'), 'STORAGE_UNAVAILABLE'],
  [new DOMException('full', 'QuotaExceededError'), 'QUOTA'],
])('maps removal opening errors without events: %s', async (error, code) => {
  const connection = {
      database: {
        transaction: () => {
          throw error
        },
      },
      closed: false,
      close: vi.fn(),
    } as unknown as DatabaseConnection,
    emit = vi.fn(),
    now = vi.fn(() => 49)
  const remove = createIndexedDbRemove(
    connection,
    { now, createOperationId: () => 'operation' },
    emit,
  )
  expect(await remove('file' as NodeId, { recursive: false })).toMatchObject({
    ok: false,
    error: { code },
  })
  expect(emit).not.toHaveBeenCalled()
  expect(now).not.toHaveBeenCalled()
})
it.each([undefined, null, {}, { recursive: 1 }, { recursive: 'true' }])(
  'rejects missing explicit boolean recursion before opening IDB: %j',
  async (options) => {
    const transaction = vi.fn(),
      emit = vi.fn()
    const connection = {
      database: { transaction },
      closed: false,
      close: vi.fn(),
    } as unknown as DatabaseConnection
    expect(
      await createIndexedDbRemove(
        connection,
        { now: () => 49, createOperationId: () => 'op' },
        emit,
      )('file' as NodeId, options as unknown as RemoveOptions),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } })
    expect(transaction).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  },
)
