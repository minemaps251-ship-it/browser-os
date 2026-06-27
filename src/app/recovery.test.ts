import { expect, it } from 'vitest'
import { getRecoveryGuidance, type RecoveryReason } from './recovery'
const reasons: readonly RecoveryReason[] = [
  'UNAVAILABLE',
  'BLOCKED',
  'TIMEOUT',
  'NEWER_DATABASE',
  'CORRUPT_SCHEMA',
  'CORRUPT_DATA',
  'READ_FAILED',
  'VERSION_CHANGED',
  'OPEN_FAILED',
  'START_FAILED',
  'TEMPORARY_FAILED',
]
it.each(reasons)('provides immutable recovery guidance for %s', (reason) => {
  const guidance = getRecoveryGuidance(reason)
  expect(guidance.title.length).toBeGreaterThan(0)
  expect(guidance.message.length).toBeGreaterThan(0)
  expect(guidance.action.length).toBeGreaterThan(0)
  expect(Object.isFrozen(guidance)).toBe(true)
})
it('distinguishes storage access, blocking, corruption and incompatible versions', () => {
  expect(getRecoveryGuidance('UNAVAILABLE').action).toContain('Allow storage')
  expect(getRecoveryGuidance('BLOCKED').action).toContain('Close other')
  expect(getRecoveryGuidance('CORRUPT_DATA').message).toContain('preserved')
  expect(getRecoveryGuidance('NEWER_DATABASE').action).toContain('last used')
})
