import { expect, it, vi } from 'vitest'
import { createIndexedDbCreateRepository } from './createRepository'
import type { DatabaseConnection } from './types'
import type { NodeId } from '../filesystem/types'
it.each([
  [new DOMException('closed', 'InvalidStateError'), 'STORAGE_UNAVAILABLE'],
  [new DOMException('full', 'QuotaExceededError'), 'QUOTA'],
])(
  'maps copy transaction opening errors without success/events: %s',
  async (error, code) => {
    const connection = {
      database: {
        transaction: () => {
          throw error
        },
      },
      closed: false,
      close: vi.fn(),
    } as unknown as DatabaseConnection
    const createNodeId = vi.fn(),
      listener = vi.fn()
    const repository = createIndexedDbCreateRepository(connection, {
      now: () => 45,
      createNodeId,
      createContentId: vi.fn(),
      createOperationId: () => 'operation',
    })
    repository.subscribe({ kind: 'all' }, listener)
    expect(
      await repository.copyFile('source' as NodeId, 'parent' as NodeId),
    ).toMatchObject({ ok: false, error: { code } })
    expect(listener).not.toHaveBeenCalled()
    expect(createNodeId).not.toHaveBeenCalled()
  },
)
