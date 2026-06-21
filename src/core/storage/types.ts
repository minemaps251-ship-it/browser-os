export type StorageErrorCode =
  | 'UNAVAILABLE'
  | 'BLOCKED'
  | 'TIMEOUT'
  | 'NEWER_DATABASE'
  | 'CORRUPT_SCHEMA'
  | 'OPEN_FAILED'
export interface StorageError {
  readonly code: StorageErrorCode
  readonly message: string
  readonly cause?: unknown
}
export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StorageError }
export interface DatabaseConnection {
  readonly database: IDBDatabase
  readonly closed: boolean
  close(): void
}
export interface SchemaRecord {
  readonly key: 'schema'
  readonly version: 1
}
export interface TotalsRecord {
  readonly key: 'totals'
  readonly nodeCount: number
  readonly textBytes: number
}
export interface ThemeSettingRecord {
  readonly key: 'theme'
  readonly value: 'system' | 'light' | 'dark'
  readonly schemaVersion: 1
}
