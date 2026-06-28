import type { VfsErrorCode } from '../../core/filesystem/types'
import { createErrorMessage } from './createError'

export function renameErrorMessage(code: VfsErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This item is no longer available. Cancel and choose another item.'
    case 'PROTECTED':
      return 'This item is protected and cannot be renamed.'
    case 'CORRUPT_DATA':
      return 'This item could not be verified. Your saved data has been preserved.'
    case 'INVALID_NAME':
    case 'ALREADY_EXISTS':
    case 'QUOTA':
    case 'STORAGE_UNAVAILABLE':
      return createErrorMessage(code)
    default:
      return 'The item could not be renamed. Please try again.'
  }
}
