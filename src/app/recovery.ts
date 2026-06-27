import type { StorageErrorCode } from '../core/storage/types'
export type RecoveryReason =
  | StorageErrorCode
  | 'CORRUPT_DATA'
  | 'READ_FAILED'
  | 'VERSION_CHANGED'
  | 'START_FAILED'
  | 'TEMPORARY_FAILED'
export interface RecoveryGuidance {
  readonly title: string
  readonly message: string
  readonly action: string
}
const guidance: Record<RecoveryReason, RecoveryGuidance> = {
  UNAVAILABLE: {
    title: 'Browser storage unavailable',
    message: 'This browser is not allowing access to your saved workspace.',
    action:
      'Allow storage for this site in browser settings, then retry. If storage is restricted, use a temporary workspace.',
  },
  BLOCKED: {
    title: 'Workspace is busy',
    message: 'Another BrowserOS tab is preventing your workspace from opening.',
    action:
      'Close other BrowserOS tabs, then retry. You do not need to clear site data.',
  },
  TIMEOUT: {
    title: 'Opening took too long',
    message: 'The browser did not finish opening your workspace in time.',
    action:
      'Close other BrowserOS tabs and retry. If the problem continues, use a temporary workspace while keeping this site’s saved data.',
  },
  NEWER_DATABASE: {
    title: 'Newer version required',
    message:
      'This saved workspace needs a newer version of BrowserOS. Its data has been preserved.',
    action:
      'Open the BrowserOS version that last used this workspace. Clearing site data would remove your saved files.',
  },
  CORRUPT_SCHEMA: {
    title: 'Workspace format is incompatible',
    message:
      'The saved workspace format is not supported. Existing browser data has been preserved.',
    action:
      'Keep this site’s saved data and try a compatible BrowserOS version. A temporary workspace lets you continue separately.',
  },
  CORRUPT_DATA: {
    title: 'Saved files could not be verified',
    message:
      'Some saved file data is missing or inconsistent. Existing browser data has been preserved.',
    action:
      'Retry if this was a temporary interruption. If it continues, use a temporary workspace and keep the original browser data for recovery.',
  },
  READ_FAILED: {
    title: 'Workspace reading was interrupted',
    message:
      'The browser could not finish reading your workspace. Saved data has been preserved.',
    action: 'Check storage permissions, close other BrowserOS tabs and retry.',
  },
  VERSION_CHANGED: {
    title: 'Workspace changed in another tab',
    message:
      'Another tab changed or removed the saved workspace. This workspace connection has been closed.',
    action:
      'Close other BrowserOS tabs, then retry to open the current workspace. If a newer version is required, use that BrowserOS version.',
  },
  OPEN_FAILED: {
    title: 'Workspace could not be opened',
    message: 'The browser could not open or prepare your workspace.',
    action:
      'Check storage permissions and available device space, then retry. Keep any existing site data.',
  },
  START_FAILED: {
    title: 'Workspace could not start',
    message:
      'BrowserOS could not start this workspace. Saved data has been preserved.',
    action:
      'Retry, or reload BrowserOS if the problem continues. A temporary workspace is also available.',
  },
  TEMPORARY_FAILED: {
    title: 'Temporary workspace could not start',
    message: 'BrowserOS could not prepare the temporary workspace.',
    action:
      'Reload BrowserOS and try again. Existing browser data has not been replaced.',
  },
}
export function getRecoveryGuidance(reason: RecoveryReason): RecoveryGuidance {
  return Object.freeze({ ...guidance[reason] })
}
