import type { FileContent, VfsResult } from './types'

/** Validate first: TextEncoder would silently replace unpaired surrogates. */
export function prepareTextContent(
  content: FileContent,
): VfsResult<{ content: FileContent; byteLength: number }> {
  if (
    !content ||
    content.kind !== 'text' ||
    content.encoding !== 'utf-8' ||
    typeof content.text !== 'string' ||
    /\p{Surrogate}/u.test(content.text)
  )
    return {
      ok: false,
      error: {
        code: 'INVALID_CONTENT',
        message: 'Content must be valid Unicode text encoded as UTF-8.',
      },
    }
  return {
    ok: true,
    value: {
      content: Object.freeze({ ...content }),
      byteLength: new TextEncoder().encode(content.text).byteLength,
    },
  }
}
