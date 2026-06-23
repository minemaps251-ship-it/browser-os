import { expect, it } from 'vitest'
import {
  assertEqual,
  assertDifferent,
  assertMatch,
  assertLength,
  assertAtMost,
  assertIncludes,
} from './assertions'
it('compares records and maps deeply, ignoring record key/map insertion order', () => {
  expect(() =>
    assertEqual(
      new Map([
        ['a', { id: 1, text: 'hello' }],
        ['b', { id: 2 }],
      ]),
      new Map([
        ['b', { id: 2 }],
        ['a', { text: 'hello', id: 1 }],
      ]),
    ),
  ).not.toThrow()
  expect(() =>
    assertEqual(
      { nodes: [{ id: 1 }], bytes: 0 },
      { bytes: 0, nodes: [{ id: 1 }] },
    ),
  ).not.toThrow()
})
it('rejects missing and changed entries, map values and ordered arrays', () => {
  for (const [actual, expected] of [
    [{ a: undefined }, {}],
    [
      [1, 2],
      [2, 1],
    ],
    [new Map([['a', 1]]), new Map([['b', 1]])],
    [new Map([['a', 1]]), new Map([['a', 2]])],
    [{ text: 'old' }, { text: 'new' }],
  ])
    expect(() => assertEqual(actual, expected)).toThrow()
})
it('matches explicit nested subsets and rejects absent properties', () => {
  expect(() =>
    assertMatch(
      { ok: false, error: { code: 'CONFLICT', message: 'detail' } },
      { error: { code: 'CONFLICT' } },
    ),
  ).not.toThrow()
  expect(() =>
    assertMatch({ error: {} }, { error: { code: 'CONFLICT' } }),
  ).toThrow()
  expect(() => assertMatch({}, { missing: undefined })).toThrow()
})
it('checks different identity and array containment rather than order', () => {
  expect(() => assertDifferent('a', 'b')).not.toThrow()
  expect(() => assertDifferent('a', 'a')).toThrow()
  expect(() => assertIncludes(['a', 'b'], ['b', 'a'])).not.toThrow()
  expect(() => assertIncludes(['a'], ['b'])).toThrow()
})
it('enforces lengths and finite ordered limits with diagnostic messages', () => {
  expect(() => assertLength([1], 1)).not.toThrow()
  expect(() => assertLength([1], 2, 'event count')).toThrow('event count')
  expect(() => assertAtMost(10, 10)).not.toThrow()
  expect(() => assertAtMost(11, 10)).toThrow()
  expect(() => assertAtMost(NaN, 10)).toThrow()
})
