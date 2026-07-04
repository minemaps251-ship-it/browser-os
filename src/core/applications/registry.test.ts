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

it('selects explicit MIME defaults independently of registration order and freezes association metadata', () => {
  const associations = [{ mime: 'text/plain', default: true }]
  const defaultApp = { ...firstApp, fileAssociations: associations }
  const other = {
    ...firstApp,
    id: 'other' as AppId,
    fileAssociations: [{ mime: 'text/plain' }],
  }
  const registry = createRegistry([other, defaultApp])
  associations[0].mime = 'changed'
  expect(registry.fileHandler('text/plain')?.id).toBe(firstApp.id)
  expect(Object.isFrozen(registry.get(firstApp.id)?.fileAssociations)).toBe(
    true,
  )
  expect(
    Object.isFrozen(registry.get(firstApp.id)?.fileAssociations?.[0]),
  ).toBe(true)
  expect(createRegistry([other]).fileHandler('text/plain')?.id).toBe(other.id)
  expect(
    createRegistry([other, { ...other, id: 'third' as AppId }]).fileHandler(
      'text/plain',
    ),
  ).toBeUndefined()
})
it('rejects duplicate defaults, invalid MIME, duplicate MIME and singleton file handlers', () => {
  const handler = {
    ...firstApp,
    fileAssociations: [{ mime: 'text/plain', default: true }],
  }
  expect(() =>
    createRegistry([handler, { ...handler, id: 'other' as AppId }]),
  ).toThrow('association')
  expect(() =>
    createRegistry([{ ...handler, instancePolicy: 'singleton' }]),
  ).toThrow('association')
  expect(() =>
    createRegistry([{ ...handler, fileAssociations: [{ mime: '*' }] }]),
  ).toThrow('association')
  expect(() =>
    createRegistry([
      {
        ...handler,
        fileAssociations: [{ mime: 'text/plain' }, { mime: 'text/plain' }],
      },
    ]),
  ).toThrow('association')
})

it('allows reuse-window only for a multiple-instance file handler', () => {
  expect(() =>
    createRegistry([{ ...firstApp, fileOpenPolicy: 'reuse-window' }]),
  ).toThrow('policy')
  const handler = {
    ...firstApp,
    fileAssociations: [{ mime: 'text/plain' }],
    fileOpenPolicy: 'reuse-window' as const,
  }
  expect(createRegistry([handler]).get(handler.id)?.fileOpenPolicy).toBe(
    'reuse-window',
  )
  expect(() =>
    createRegistry([{ ...handler, instancePolicy: 'singleton' }]),
  ).toThrow('policy')
})
