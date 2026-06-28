import type { VfsErrorCode } from '../../core/filesystem/types'
import { createErrorMessage } from './createError'
export function transferErrorMessage(code: VfsErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'The source or destination is no longer available. Check the folder and try again.'
    case 'NOT_DIRECTORY':
      return 'The destination is no longer a folder. Choose another folder.'
    case 'NOT_FILE':
      return 'Only files can be copied.'
    case 'CYCLE':
      return 'A folder cannot be moved into itself or one of its subfolders.'
    case 'PROTECTED':
      return 'The source or destination is protected. Choose a permitted location.'
    case 'CORRUPT_DATA':
      return 'The source or destination could not be verified. Your saved data has been preserved.'
    case 'INVALID_NAME':
    case 'ALREADY_EXISTS':
    case 'QUOTA':
    case 'TOO_LARGE':
    case 'STORAGE_UNAVAILABLE':
      return createErrorMessage(code)
    default:
      return 'The operation could not be completed. Please try again.'
  }
}
