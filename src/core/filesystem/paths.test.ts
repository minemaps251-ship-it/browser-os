import { expect, it } from 'vitest'
import { parsePath } from './paths'
import { INITIAL_DIRECTORIES } from './policy'

it.each(['/', '///'])('parses root %j without a fake empty name', (path) => {
  expect(parsePath(path)).toEqual({
    ok: true,
    value: { kind: 'absolute', segments: [], requiresDirectory: true },
  })
})
it('collapses slashes and normalizes names without trimming spaces', () => {
  expect(parsePath('//home///user/Cafe\u0301/My File.txt')).toEqual({
    ok: true,
    value: {
      kind: 'absolute',
      segments: [
        { kind: 'name', name: 'home' },
        { kind: 'name', name: 'user' },
        { kind: 'name', name: 'Café' },
        { kind: 'name', name: 'My File.txt' },
      ],
      requiresDirectory: false,
    },
  })
})
it('preserves traversal steps rather than bypassing missing nodes or file/.. checks', () => {
  expect(parsePath('missing/.././Documents')).toEqual({
    ok: true,
    value: {
      kind: 'relative',
      segments: [
        { kind: 'name', name: 'missing' },
        { kind: 'parent' },
        { kind: 'current' },
        { kind: 'name', name: 'Documents' },
      ],
      requiresDirectory: false,
    },
  })
  expect(parsePath('/../../home')).toMatchObject({
    ok: true,
    value: {
      kind: 'absolute',
      segments: [
        { kind: 'parent' },
        { kind: 'parent' },
        { kind: 'name', name: 'home' },
      ],
    },
  })
})
it.each(['dir/', 'file/.', 'dir/..', '.', '..'])(
  'requires a directory for %j',
  (path) => {
    expect(parsePath(path)).toMatchObject({
      ok: true,
      value: { requiresDirectory: true },
    })
  },
)
it('does not perform shell expansion, URI decoding or Windows path conversion', () => {
  expect(parsePath('~/%2F/a\\b')).toMatchObject({
    ok: true,
    value: {
      kind: 'relative',
      segments: [
        { kind: 'name', name: '~' },
        { kind: 'name', name: '%2F' },
        { kind: 'name', name: 'a\\b' },
      ],
    },
  })
})
it('rejects empty paths and invalid components with typed diagnostics', () => {
  expect(parsePath('')).toMatchObject({
    ok: false,
    error: { code: 'INVALID_PATH' },
  })
  expect(parsePath('home/\0/bad')).toMatchObject({
    ok: false,
    error: { code: 'INVALID_NAME', path: 'home/\0/bad' },
  })
  expect(parsePath('/' + 'x'.repeat(256))).toMatchObject({
    ok: false,
    error: { code: 'INVALID_NAME' },
  })
})
it('initial directory specifications are valid absolute paths and deeply immutable', () => {
  expect(INITIAL_DIRECTORIES.map((dir) => dir.path)).toEqual([
    '/',
    '/home',
    '/home/user',
    '/home/user/Documents',
    '/home/user/Desktop',
    '/system',
  ])
  for (const dir of INITIAL_DIRECTORIES) {
    expect(parsePath(dir.path)).toMatchObject({
      ok: true,
      value: { kind: 'absolute' },
    })
    expect(Object.isFrozen(dir)).toBe(true)
  }
  expect(Object.isFrozen(INITIAL_DIRECTORIES)).toBe(true)
})
