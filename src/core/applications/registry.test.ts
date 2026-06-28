import { describe, expect, it } from 'vitest'
import { createRegistry } from './registry'
import { firstApp } from '../../test/fixtures'
import type { AppId } from '../shared/ids'

describe('application registry', () => {
  it('looks up immutable metadata without loading any renderer', () => {
    const registry = createRegistry([firstApp])
    expect(registry.get(firstApp.id)?.name).toBe('First app')
    expect(registry.get('missing' as AppId)).toBeUndefined()
    expect(registry.list()).toHaveLength(1)
    expect(Object.isFrozen(registry.list()[0].window.defaultSize)).toBe(true)
  })
  it('rejects duplicate application IDs', () => {
    expect(() => createRegistry([firstApp, firstApp])).toThrow('duplicate')
  })
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid default geometry %s',
    (width) => {
      expect(() =>
        createRegistry([
          {
            ...firstApp,
            window: { ...firstApp.window, defaultSize: { width, height: 300 } },
          },
        ]),
      ).toThrow('Invalid')
    },
  )
  it('rejects defaults smaller than the minimum', () => {
    expect(() =>
      createRegistry([
        {
          ...firstApp,
          window: {
            defaultSize: { width: 100, height: 100 },
            minSize: { width: 200, height: 200 },
          },
        },
      ]),
    ).toThrow('Invalid')
  })
})

it('accepts explicit Dock pinning for a multi-instance app', () => {
  expect(
    createRegistry([{ ...firstApp, dock: 'pinned' }]).get(firstApp.id)?.dock,
  ).toBe('pinned')
})
