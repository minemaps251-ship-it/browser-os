export type LineEnding = '\n' | '\r\n' | '\r'
export function lineEnding(
  text: string,
  preferred: LineEnding = '\n',
): LineEnding | 'mixed' {
  const endings = new Set(text.match(/\r\n|\r|\n/g) ?? [])
  if (endings.size > 1) return 'mixed'
  return (endings.values().next().value as LineEnding | undefined) ?? preferred
}
export function restoreLineEnding(text: string, separator: LineEnding) {
  return text.replace(/\r\n|\r|\n/g, separator)
}
export function codeLanguage(
  name: string,
): 'javascript' | 'jsx' | 'typescript' | 'tsx' | 'plain' {
  const dot = name.lastIndexOf('.')
  const extension = dot >= 0 ? name.slice(dot + 1).toLowerCase() : undefined
  if (extension === 'tsx') return 'tsx'
  if (extension === 'ts') return 'typescript'
  if (extension === 'jsx') return 'jsx'
  if (['js', 'mjs', 'cjs'].includes(extension ?? '')) return 'javascript'
  return 'plain'
}
