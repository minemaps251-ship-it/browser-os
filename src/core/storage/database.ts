import {
  DATABASE_NAME,
  DATABASE_VERSION,
  initializeSchema,
  validateSchema,
} from './schema'
import type { NodeId } from '../filesystem/types'
import type {
  DatabaseConnection,
  StorageErrorCode,
  StorageResult,
} from './types'
function openingErrorCode(cause: unknown): StorageErrorCode {
  if (typeof cause === 'object' && cause !== null && 'name' in cause) {
    if (cause.name === 'VersionError') return 'NEWER_DATABASE'
    if (cause.name === 'SecurityError' || cause.name === 'NotAllowedError')
      return 'UNAVAILABLE'
  }
  return 'OPEN_FAILED'
}
export interface OpenDatabaseOptions {
  readonly name?: string
  readonly factory?: IDBFactory
  readonly now?: () => number
  readonly createNodeId?: () => NodeId
  readonly timeoutMs?: number
  readonly onVersionChange?: (newVersion: number | null) => void | Promise<void>
}
export function openDatabase(
  options: OpenDatabaseOptions = {},
): Promise<StorageResult<DatabaseConnection>> {
  let factory: IDBFactory | undefined
  try {
    factory =
      options.factory ??
      (typeof indexedDB === 'undefined' ? undefined : indexedDB)
  } catch (cause) {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'UNAVAILABLE',
        message: 'IndexedDB access is denied.',
        cause,
      },
    })
  }
  if (!factory)
    return Promise.resolve({
      ok: false,
      error: { code: 'UNAVAILABLE', message: 'IndexedDB is unavailable.' },
    })
  return new Promise((resolve) => {
    let settled = false
    const timeoutMs = options.timeoutMs ?? 5000
    let timer: ReturnType<typeof setTimeout> | undefined
    function fail(code: StorageErrorCode, message: string, cause?: unknown) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok: false, error: { code, message, cause } })
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      fail('OPEN_FAILED', 'Opening timeout must be positive.')
      return
    }
    try {
      const request = factory.open(
        options.name ?? DATABASE_NAME,
        DATABASE_VERSION,
      )
      timer = setTimeout(
        () => fail('TIMEOUT', 'Opening IndexedDB timed out.'),
        timeoutMs,
      )
      request.onblocked = () =>
        fail('BLOCKED', 'Another connection blocks database initialization.')
      request.onerror = () =>
        fail(
          openingErrorCode(request.error),
          'Could not open IndexedDB.',
          request.error,
        )
      request.onupgradeneeded = (event) => {
        if (settled) {
          request.transaction?.abort()
          return
        }
        try {
          if (event.oldVersion !== 0)
            throw new Error('Unsupported schema upgrade')
          initializeSchema(
            request.result,
            options.now ?? Date.now,
            options.createNodeId ?? (() => crypto.randomUUID() as NodeId),
          )
        } catch (cause) {
          request.transaction?.abort()
          fail('OPEN_FAILED', 'Database initialization failed.', cause)
        }
      }
      request.onsuccess = () => {
        const database = request.result
        if (settled) {
          database.close()
          return
        }
        try {
          if (!validateSchema(database)) {
            database.close()
            fail('CORRUPT_SCHEMA', 'Database schema is incompatible.')
            return
          }
          let closed = false
          const close = () => {
            if (!closed) {
              closed = true
              database.close()
            }
          }
          database.onversionchange = (event) => {
            close()
            try {
              const result = options.onVersionChange?.(event.newVersion)
              if (result) void result.catch(() => {})
            } catch {
              /* Closing the connection must not depend on UI callbacks. */
            }
          }
          database.onclose = () => {
            closed = true
          }
          settled = true
          clearTimeout(timer)
          resolve({
            ok: true,
            value: {
              database,
              get closed() {
                return closed
              },
              close,
            },
          })
        } catch (cause) {
          database.close()
          fail('CORRUPT_SCHEMA', 'Could not validate database schema.', cause)
        }
      }
    } catch (cause) {
      fail(openingErrorCode(cause), 'IndexedDB opening failed.', cause)
    }
  })
}
