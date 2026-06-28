import type { VfsErrorCode } from '../../core/filesystem/types'
import { createErrorMessage } from './createError'

export function deleteErrorMessage(code: VfsErrorCode): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'This item has already been removed. Close this dialog to refresh the folder.'
    case 'NOT_EMPTY':
      return 'This folder is not empty. To delete it, confirm removal of the folder and all its contents.'
    case 'PROTECTED':
      return 'This item or an item inside it is protected and cannot be deleted.'
    case 'CORRUPT_DATA':
      return 'This item could not be verified. Your saved data has been preserved.'
    case 'QUOTA':
    case 'STORAGE_UNAVAILABLE':
      return createErrorMessage(code)
    default:
      return 'The item could not be deleted. Please try again.'
  }
}
