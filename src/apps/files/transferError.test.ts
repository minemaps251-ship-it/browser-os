import { expect, it } from 'vitest'
import { transferErrorMessage } from './transferError'
import type { VfsErrorCode } from '../../core/filesystem/types'
it.each([
  ['NOT_FOUND', 'no longer available'],
  ['NOT_DIRECTORY', 'no longer a folder'],
  ['NOT_FILE', 'Only files'],
  ['CYCLE', 'subfolders'],
  ['PROTECTED', 'protected'],
  ['CORRUPT_DATA', 'preserved'],
  ['INVALID_NAME', 'without slashes'],
  ['ALREADY_EXISTS', 'already exists'],
  ['QUOTA', 'storage is full'],
  ['TOO_LARGE', 'workspace limit'],
  ['STORAGE_UNAVAILABLE', 'unavailable'],
  ['INVALID_REQUEST', 'try again'],
] satisfies [VfsErrorCode, string][])(
  'explains transfer failure %s',
  (code, message) => {
    expect(transferErrorMessage(code)).toContain(message)
  },
)
