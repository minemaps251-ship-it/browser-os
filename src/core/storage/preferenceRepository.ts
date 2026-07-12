import {
  decodePreferences,
  type PreferenceRepository,
} from '../preferences/service'
import { STORES } from './schema'
import { requestResult, transactionDone } from './requests'
import type { DatabaseConnection } from './types'

export function createIndexedDbPreferenceRepository(
  connection: DatabaseConnection,
): PreferenceRepository {
  async function transact(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<unknown>,
  ) {
    const transaction = connection.database.transaction(STORES.settings, mode)
    const done = transactionDone(transaction).then(
      () => true,
      () => false,
    )
    try {
      const value = await operation(transaction.objectStore(STORES.settings))
      if (!(await done))
        throw new Error(
          'Desktop preferences could not be saved. Your previous settings have been kept.',
        )
      return value
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        /* Already complete. */
      }
      await done
      throw error
    }
  }
  return {
    read: async () => {
      const raw = await transact('readonly', (store) =>
        requestResult<unknown>(store.get('shell')),
      )
      if (raw === undefined) return decodePreferences(undefined)
      if (
        !raw ||
        typeof raw !== 'object' ||
        !('schemaVersion' in raw) ||
        raw.schemaVersion !== 1 ||
        !('value' in raw)
      )
        throw new Error(
          'Saved desktop preferences are invalid. Reset them in Settings to recover.',
        )
      return decodePreferences(raw.value)
    },
    write: async (value) => {
      await transact('readwrite', (store) =>
        requestResult(
          store.put({
            key: 'shell',
            schemaVersion: 1,
            value: decodePreferences(value),
          }),
        ),
      )
    },
  }
}
