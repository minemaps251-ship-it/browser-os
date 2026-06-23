/** Small test-only assertions shared by Node/Vitest and the native browser harness. */
function same(actual: unknown, expected: unknown): boolean {
  if (Object.is(actual, expected)) return true
  if (actual instanceof Map && expected instanceof Map)
    return (
      actual.size === expected.size &&
      [...expected].every(
        ([key, value]) => actual.has(key) && same(actual.get(key), value),
      )
    )
  if (Array.isArray(actual) && Array.isArray(expected))
    return (
      actual.length === expected.length &&
      expected.every((value, index) => same(actual[index], value))
    )
  if (
    !actual ||
    !expected ||
    typeof actual !== 'object' ||
    typeof expected !== 'object' ||
    Array.isArray(actual) ||
    Array.isArray(expected) ||
    actual instanceof Map ||
    expected instanceof Map
  )
    return false
  const left = Object.keys(actual),
    right = Object.keys(expected)
  return (
    left.length === right.length &&
    right.every(
      (key) =>
        Object.hasOwn(actual, key) &&
        same(Reflect.get(actual, key), Reflect.get(expected, key)),
    )
  )
}
function fail(label: string, message?: string): never {
  throw new Error(message ? `${message}: ${label}` : label)
}
function preview(value: unknown) {
  const serialized = JSON.stringify(value, (_key, entry: unknown) =>
    entry instanceof Map ? [...entry] : entry,
  )
  return serialized?.slice(0, 240) ?? String(value)
}
export function assertEqual(
  actual: unknown,
  expected: unknown,
  message?: string,
) {
  if (!same(actual, expected))
    fail(`Expected ${preview(expected)}; received ${preview(actual)}`, message)
}
export function assertDifferent(
  actual: unknown,
  expected: unknown,
  message?: string,
) {
  if (same(actual, expected)) fail('Values must differ', message)
}
export function assertMatch(
  actual: unknown,
  expected: unknown,
  message?: string,
) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected))
    return assertEqual(actual, expected, message)
  if (!actual || typeof actual !== 'object') fail('Expected an object', message)
  for (const key of Object.keys(expected)) {
    if (!Object.hasOwn(actual, key)) fail(`Missing property ${key}`, message)
    assertMatch(Reflect.get(actual, key), Reflect.get(expected, key), message)
  }
}
export function assertLength(
  actual: { readonly length: number },
  expected: number,
  message?: string,
) {
  assertEqual(actual.length, expected, message)
}
export function assertAtMost(
  actual: number,
  expected: number,
  message?: string,
) {
  if (!(actual <= expected)) fail(`Expected ${actual} <= ${expected}`, message)
}
export function assertIncludes(
  actual: readonly unknown[],
  expected: readonly unknown[],
  message?: string,
) {
  for (const item of expected)
    if (!actual.some((value) => same(value, item)))
      fail('Missing array entry', message)
}
