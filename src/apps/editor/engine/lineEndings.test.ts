import { expect, it } from 'vitest'
import { codeLanguage, lineEnding, restoreLineEnding } from './lineEndings'
it('identifies uniform, empty and mixed line endings without normalizing source', () => {
  expect(lineEnding('a\r\nb\r\n')).toBe('\r\n')
  expect(lineEnding('a\rb')).toBe('\r')
  expect(lineEnding('a\nb')).toBe('\n')
  expect(lineEnding('', '\r\n')).toBe('\r\n')
  expect(lineEnding('a\r\nb\nc')).toBe('mixed')
  expect(lineEnding('a\rb\nc')).toBe('mixed')
  expect(restoreLineEnding('a\r\nb\nc\rd', '\r\n')).toBe('a\r\nb\r\nc\r\nd')
})
it('selects grammar by filename and keeps unknown extensions plain text', () => {
  expect(codeLanguage('hello.TS')).toBe('typescript')
  expect(codeLanguage('hello.tsx')).toBe('tsx')
  expect(codeLanguage('hello.jsx')).toBe('jsx')
  for (const name of ['a.js', 'a.cjs', 'a.mjs'])
    expect(codeLanguage(name)).toBe('javascript')
  for (const name of ['Untitled', 'ts', 'js', 'a.txt', 'a.html'])
    expect(codeLanguage(name)).toBe('plain')
})
