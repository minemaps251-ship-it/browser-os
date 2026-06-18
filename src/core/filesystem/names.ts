import { VFS_LIMITS } from './policy'
import type { VfsResult } from './types'

/** A single non-root name; whitespace, case and literal backslashes are preserved. */
export function normalizeName(name: string): VfsResult<string> {
  const normalized = name.normalize('NFC')
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.includes('/') ||
    /\p{Cc}|\p{Surrogate}/u.test(normalized)
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_NAME',
        message:
          'Names must be non-empty and cannot contain slashes, control characters, invalid Unicode, or be . or ...',
      },
    }
  }
  // Code points, not UTF-16 code units or UTF-8 bytes; normalize before counting.
  if ([...normalized].length > VFS_LIMITS.maxNameCodePoints) {
    return {
      ok: false,
      error: {
        code: 'INVALID_NAME',
        message: `Names cannot exceed ${VFS_LIMITS.maxNameCodePoints} Unicode code points.`,
      },
    }
  }
  return { ok: true, value: normalized }
}
