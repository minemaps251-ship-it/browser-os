import { expect, it } from 'vitest'
import { parseCommand } from './parser'
it.each([
  ['', []],
  ['  pwd\t', ['pwd']],
  ['cd "My folder"', ['cd', 'My folder']],
  ["ls 'one two'", ['ls', 'one two']],
  ['cd My\\ folder', ['cd', 'My folder']],
  ['ls a" b"c', ['ls', 'a bc']],
  ['cd ""', ['cd', '']],
  ["ls 'a\\b'", ['ls', 'a\\b']],
  ['ls "a\\"b"', ['ls', 'a"b']],
  ['ls ";$|"', ['ls', ';$|']],
  ['ls a\\;b', ['ls', 'a;b']],
] satisfies [string, string[]][])('tokenizes %s', (input, tokens) => {
  expect(parseCommand(input)).toEqual({ ok: true, tokens })
})
it.each([
  'pwd;ls',
  'pwd|ls',
  'ls > file',
  'ls && pwd',
  'ls $HOME',
  'ls `pwd`',
  'ls (a)',
  'pwd\nls',
  'ls\u0000',
  'ls "unterminated',
  'ls trailing\\',
  'x'.repeat(4097),
  Array(130).fill('x').join(' '),
])('rejects unsupported/incomplete command %s', (input) => {
  expect(parseCommand(input)).toMatchObject({ ok: false })
})
it('reports source position and freezes tokens', () => {
  expect(parseCommand('ls "bad')).toMatchObject({ ok: false, position: 3 })
  const parsed = parseCommand('pwd')
  expect(parsed.ok && Object.isFrozen(parsed.tokens)).toBe(true)
})
