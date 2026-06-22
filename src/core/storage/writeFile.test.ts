import { expect, it, vi } from 'vitest'
import { createIndexedDbWriteFile } from './writeFile'
import type { DatabaseConnection } from './types'
import type { NodeId } from '../filesystem/types'
it.each([
  [new DOMException('closed', 'InvalidStateError'), 'STORAGE_UNAVAILABLE'],
  [new DOMException('denied', 'SecurityError'), 'STORAGE_UNAVAILABLE'],
  [new DOMException('full', 'QuotaExceededError'), 'QUOTA'],
])(
  'maps transaction-opening errors without publishing success: %s',
  async (error, code) => {
    const transaction = vi.fn(() => {
        throw error
      }),
      emit = vi.fn()
    const connection = {
      database: { transaction },
      closed: false,
      close: vi.fn(),
    } as unknown as DatabaseConnection
    const operationId = vi.fn(() => 'operation')
    const write = createIndexedDbWriteFile(
      connection,
      { now: () => 42, createOperationId: operationId },
      emit,
    )
    expect(
      await write(
        'file' as NodeId,
        { kind: 'text', encoding: 'utf-8', text: 'hello' },
        { expectedContentRevision: 1, requestId: 'save' },
      ),
    ).toMatchObject({ ok: false, error: { code } })
    expect(emit).not.toHaveBeenCalled()
    expect(operationId).not.toHaveBeenCalled()
  },
)
