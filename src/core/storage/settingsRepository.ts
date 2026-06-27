import {
  decodeTheme,
  isThemePreference,
  settingsFailure,
  type SettingsRepository,
  type SettingsResult,
} from '../settings/types'
import { STORES } from './schema'
import { requestResult, transactionDone } from './requests'
import type { DatabaseConnection, ThemeSettingRecord } from './types'
function storageFailure(cause: unknown) {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'name' in cause &&
    cause.name === 'QuotaExceededError'
  ) {
    return settingsFailure(
      'QUOTA',
      'Your browser storage is full. Free space on your device, then retry. Your previous appearance setting is unchanged.',
    )
  }
  return settingsFailure(
    'STORAGE_UNAVAILABLE',
    'The appearance setting could not be accessed. Please retry.',
  )
}
export function createIndexedDbSettingsRepository(
  connection: DatabaseConnection,
): SettingsRepository {
  async function transact<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<SettingsResult<T>>,
  ): Promise<SettingsResult<T>> {
    let transaction: IDBTransaction | undefined
    let completion: Promise<boolean> | undefined
    try {
      transaction = connection.database.transaction(STORES.settings, mode)
      completion = transactionDone(transaction).then(
        () => true,
        () => false,
      )
      const result = await operation(transaction.objectStore(STORES.settings))
      if (!(await completion)) return storageFailure(transaction.error)
      return result
    } catch (cause) {
      try {
        transaction?.abort()
      } catch {
        /* Already completed or aborted. */
      }
      await completion
      return storageFailure(cause)
    }
  }
  return {
    readTheme: () =>
      transact('readonly', async (store) =>
        decodeTheme(await requestResult<unknown>(store.get('theme'))),
      ),
    writeTheme: (value) => {
      if (!isThemePreference(value))
        return Promise.resolve(
          settingsFailure('INVALID_VALUE', 'Choose a supported theme.'),
        )
      return transact('readwrite', async (store) => {
        await requestResult(
          store.put({
            key: 'theme',
            value,
            schemaVersion: 1,
          } satisfies ThemeSettingRecord),
        )
        return { ok: true, value: undefined }
      })
    },
  }
}
