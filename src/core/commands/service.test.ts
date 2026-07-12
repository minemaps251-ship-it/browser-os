import { describe, expect, it, vi } from 'vitest'
import { createCommandService, type AppCommand } from './service'
import type { ProcessId } from '../shared/ids'
const owner = 'process' as ProcessId
const command = (run = vi.fn()): AppCommand => ({
  id: 'save',
  label: 'Save',
  group: 'File',
  enabled: true,
  run,
})
describe('process commands', () => {
  it('executes the current callback and enforces enabled state', () => {
    const service = createCommandService(),
      first = vi.fn(),
      second = vi.fn()
    service.register(owner, [command(first)])
    expect(service.execute(owner, 'save')).toBe(true)
    service.register(owner, [{ ...command(second), enabled: false }])
    expect(service.execute(owner, 'save')).toBe(false)
    service.register(owner, [command(second)])
    service.execute(owner, 'save')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
  it('ignores stale cleanup and isolates owners; closing removes commands', () => {
    const service = createCommandService()
    const old = service.register(owner, [command()])
    service.register(owner, [command()])
    old()
    expect(service.list(owner)).toHaveLength(1)
    expect(service.list('another' as ProcessId)).toEqual([])
    service.remove(owner)
    expect(service.execute(owner, 'save')).toBe(false)
  })
  it('provides stable snapshots and rejects duplicate IDs', () => {
    const service = createCommandService()
    expect(service.list(null)).toBe(service.list(null))
    expect(() => service.register(owner, [command(), command()])).toThrow(
      'Duplicate',
    )
    service.register(owner, [command()])
    expect(service.list(owner)).toBe(service.list(owner))
    service.dispose()
    expect(service.execute(owner, 'save')).toBe(false)
  })
})
