import { normalizeName } from './names'
import type { VfsResult } from './types'

export type PathSegment =
  | { readonly kind: 'name'; readonly name: string }
  | { readonly kind: 'current' }
  | { readonly kind: 'parent' }

export interface ParsedPath {
  readonly kind: 'absolute' | 'relative'
  readonly segments: readonly PathSegment[]
  readonly requiresDirectory: boolean
}

/** Parses syntax only. Tree traversal must validate every intermediate directory. */
export function parsePath(path: string): VfsResult<ParsedPath> {
  if (path.length === 0) {
    return {
      ok: false,
      error: { code: 'INVALID_PATH', message: 'A path cannot be empty.' },
    }
  }
  const segments: PathSegment[] = []
  for (const part of path.split('/')) {
    if (part === '') continue
    if (part === '.') segments.push({ kind: 'current' })
    else if (part === '..') segments.push({ kind: 'parent' })
    else {
      const result = normalizeName(part)
      if (!result.ok) return { ok: false, error: { ...result.error, path } }
      segments.push({ kind: 'name', name: result.value })
    }
  }
  return {
    ok: true,
    value: {
      kind: path.startsWith('/') ? 'absolute' : 'relative',
      segments,
      requiresDirectory:
        path.endsWith('/') ||
        segments.at(-1)?.kind === 'current' ||
        segments.at(-1)?.kind === 'parent',
    },
  }
}
