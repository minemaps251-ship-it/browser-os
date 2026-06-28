import { expect, it } from 'vitest'
import { deleteErrorMessage } from './deleteError'
import type { VfsErrorCode } from '../../core/filesystem/types'
it.each([
  ['NOT_FOUND', 'already been removed'],
  ['NOT_EMPTY', 'all its contents'],
  ['PROTECTED', 'protected'],
  ['QUOTA', 'storage is full'],
  ['STORAGE_UNAVAILABLE', 'unavailable'],
  ['CORRUPT_DATA', 'preserved'],
  ['INVALID_REQUEST', 'try again'],
] satisfies [VfsErrorCode, string][])(
  'explains deletion failure %s',
  (code, text) => {
    expect(deleteErrorMessage(code)).toContain(text)
  },
)
