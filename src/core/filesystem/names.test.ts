import { expect, it } from 'vitest'
import { normalizeName } from './names'

it.each([
  '',
  '.',
  '..',
  'a/b',
  '\0',
  'a\nb',
  'a\tb',
  '\u007f',
  '\u0085',
  '\ud800',
  '\udfff',
])('rejects invalid name %j', (name) => {
  expect(normalizeName(name)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_NAME' },
  })
})
it('normalizes Unicode before comparisons and length checks', () => {
  expect(normalizeName('Cafe\u0301')).toEqual({ ok: true, value: 'Café' })
  expect(normalizeName('e\u0301'.repeat(255))).toEqual({
    ok: true,
    value: 'é'.repeat(255),
  })
})
it('counts astral Unicode as code points and accepts the exact boundary', () => {
  expect(normalizeName('😀'.repeat(255)).ok).toBe(true)
  expect(normalizeName('😀'.repeat(256)).ok).toBe(false)
  expect(normalizeName('a'.repeat(255)).ok).toBe(true)
  expect(normalizeName('a'.repeat(256)).ok).toBe(false)
})
it.each([
  ' My File.txt ',
  '   ',
  'Readme',
  'README',
  '~',
  '%2F',
  'a\\b',
  'данные.txt',
  '文書',
])('preserves valid literal name %j', (name) => {
  expect(normalizeName(name)).toEqual({ ok: true, value: name })
})
