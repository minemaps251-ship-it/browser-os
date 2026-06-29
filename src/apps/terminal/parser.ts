export type ParseResult =
  | { readonly ok: true; readonly tokens: readonly string[] }
  | { readonly ok: false; readonly message: string; readonly position: number }
export function parseCommand(input: string): ParseResult {
  if (input.length > 4096)
    return {
      ok: false,
      message: 'Command exceeds 4096 characters.',
      position: 4096,
    }
  const tokens: string[] = []
  let token = ''
  let started = false
  let quote: 'single' | 'double' | null = null
  let quotePosition = 0
  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    if (
      char === '\n' ||
      char === '\r' ||
      (char.charCodeAt(0) < 32 && char !== '\t')
    )
      return {
        ok: false,
        message: 'Control characters and multiple lines are not supported.',
        position: i,
      }
    if (quote === 'single') {
      if (char === "'") quote = null
      else token += char
      continue
    }
    if (char === '\\') {
      if (i + 1 === input.length)
        return {
          ok: false,
          message: 'Trailing escape needs another character.',
          position: i,
        }
      const escaped = input[++i]
      if (escaped === '\n' || escaped === '\r' || escaped.charCodeAt(0) < 32)
        return {
          ok: false,
          message: 'Escaped control characters are not supported.',
          position: i,
        }
      token += escaped
      started = true
      continue
    }
    if (quote === 'double') {
      if (char === '"') quote = null
      else token += char
      continue
    }
    if (char === "'" || char === '"') {
      started = true
      quote = char === "'" ? 'single' : 'double'
      quotePosition = i
      continue
    }
    if ('|&;<>`$()'.includes(char))
      return {
        ok: false,
        message:
          'Shell operators and expansion are not supported. Quote literal characters.',
        position: i,
      }
    if (char === ' ' || char === '\t') {
      if (started) {
        tokens.push(token)
        token = ''
        started = false
      }
    } else {
      started = true
      token += char
    }
    if (tokens.length > 128)
      return { ok: false, message: 'Too many arguments.', position: i }
  }
  if (quote)
    return { ok: false, message: 'Unclosed quote.', position: quotePosition }
  if (started) tokens.push(token)
  if (tokens.length > 128)
    return { ok: false, message: 'Too many arguments.', position: input.length }
  return { ok: true, tokens: Object.freeze(tokens) }
}
