import type { VfsErrorCode } from '../../core/filesystem/types'
import { VFS_LIMITS } from '../../core/filesystem/policy'

export function createErrorMessage(code: VfsErrorCode): string {
  switch (code) {
    case 'INVALID_NAME':
      return `Enter a name of up to ${VFS_LIMITS.maxNameCodePoints} characters, without slashes or control characters. The names . and .. are not allowed.`
    case 'ALREADY_EXISTS':
      return 'An item with this name already exists. Choose another name.'
    case 'NOT_FOUND':
    case 'NOT_DIRECTORY':
      return 'The destination folder is no longer available. Cancel and choose another folder.'
    case 'PROTECTED':
      return 'Items cannot be created in this protected folder.'
    case 'TOO_LARGE':
      return 'The workspace limit has been reached. Remove unused items before trying again.'
    case 'QUOTA':
      return 'Browser storage is full. Free some storage and try again.'
    case 'STORAGE_UNAVAILABLE':
      return 'Storage is unavailable. Your name has been kept; try again when storage is available.'
    case 'CORRUPT_DATA':
      return 'The destination could not be verified. Your saved data has been preserved.'
    default:
      return 'The item could not be created. Please try again.'
  }
}
