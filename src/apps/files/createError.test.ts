import { expect, it } from 'vitest'
import { createErrorMessage } from './createError'
import type { VfsErrorCode } from '../../core/filesystem/types'

it.each([
  ['INVALID_NAME', 'without slashes'],
  ['ALREADY_EXISTS', 'already exists'],
  ['NOT_FOUND', 'no longer available'],
  ['NOT_DIRECTORY', 'no longer available'],
  ['PROTECTED', 'protected'],
  ['TOO_LARGE', 'workspace limit'],
  ['QUOTA', 'storage is full'],
  ['STORAGE_UNAVAILABLE', 'Storage is unavailable'],
  ['CORRUPT_DATA', 'preserved'],
  ['INVALID_REQUEST', 'try again'],
] satisfies [VfsErrorCode, string][])(
  'provides actionable creation guidance for %s',
  (code, text) => {
    expect(createErrorMessage(code)).toContain(text)
  },
)
