export type AppId = string & { readonly __brand: 'AppId' }
export type ProcessId = string & { readonly __brand: 'ProcessId' }
export type WindowId = string & { readonly __brand: 'WindowId' }

export interface IdFactory {
  process(): ProcessId
  window(): WindowId
}
