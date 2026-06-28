import { expect, it } from 'vitest'
import { renameErrorMessage } from './renameError'
import type { VfsErrorCode } from '../../core/filesystem/types'
it.each([
  ['INVALID_NAME', 'without slashes'],
  ['ALREADY_EXISTS', 'already exists'],
  ['NOT_FOUND', 'no longer available'],
  ['PROTECTED', 'protected'],
  ['QUOTA', 'storage is full'],
  ['STORAGE_UNAVAILABLE', 'unavailable'],
  ['CORRUPT_DATA', 'preserved'],
  ['INVALID_REQUEST', 'try again'],
] satisfies [VfsErrorCode, string][])(
  'explains rename failure %s',
  (code, text) => {
    expect(renameErrorMessage(code)).toContain(text)
  },
)
