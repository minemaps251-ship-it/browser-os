import { describe, expect, it } from 'vitest'
import { decodeTotals } from './totals'
const schema = { key: 'schema', version: 1 }
describe('stored creation counters', () => {
  it('accepts an exact count and bounded UTF-8 bytes', () => {
    expect(
      decodeTotals({ key: 'totals', nodeCount: 6, textBytes: 0 }, 6, schema).ok,
    ).toBe(true)
  })
  it.each([
    undefined,
    {},
    { key: 'totals', nodeCount: 7, textBytes: 0 },
    { key: 'totals', nodeCount: 6, textBytes: -1 },
    { key: 'totals', nodeCount: 6, textBytes: 0.5 },
    { key: 'totals', nodeCount: 6, textBytes: 10485761 },
  ])('rejects malformed or mismatched counters %j', (raw) => {
    expect(decodeTotals(raw, 6, schema)).toMatchObject({
      ok: false,
      error: { code: 'CORRUPT_DATA' },
    })
  })
  it('rejects an invalid schema', () => {
    expect(
      decodeTotals({ key: 'totals', nodeCount: 6, textBytes: 0 }, 6, {
        key: 'schema',
        version: 2,
      }).ok,
    ).toBe(false)
  })
})
