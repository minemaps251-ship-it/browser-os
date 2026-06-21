import { expect, it } from 'vitest'
import { openDatabase } from './database'
import { DATABASE_VERSION, INDEXES, STORES } from './schema'
it('reports unavailable storage without importing browser state', async () => {
  expect(await openDatabase()).toMatchObject({
    ok: false,
    error: { code: 'UNAVAILABLE' },
  })
})
it('translates a synchronously denied opening into a typed error', async () => {
  const factory = {
    open: () => {
      throw new Error('denied')
    },
  } as unknown as IDBFactory
  expect(await openDatabase({ factory })).toMatchObject({
    ok: false,
    error: { code: 'OPEN_FAILED' },
  })
})
it('rejects an invalid timeout before asking the browser to open storage', async () => {
  const factory = {
    open: () => {
      throw new Error('must not open')
    },
  } as unknown as IDBFactory
  expect(await openDatabase({ factory, timeoutMs: NaN })).toMatchObject({
    ok: false,
    error: {
      code: 'OPEN_FAILED',
      message: 'Opening timeout must be positive.',
    },
  })
})
it('defines a fixed separate-store v1 schema', () => {
  expect(DATABASE_VERSION).toBe(1)
  expect(Object.values(STORES)).toEqual([
    'nodes',
    'contents',
    'meta',
    'settings',
  ])
  expect(INDEXES).toEqual({ parent: 'byParent', sibling: 'bySibling' })
})

it('reports a denied global storage accessor as unavailable', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get() {
      throw new Error('denied')
    },
  })
  try {
    expect(await openDatabase()).toMatchObject({
      ok: false,
      error: { code: 'UNAVAILABLE' },
    })
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
  }
})
