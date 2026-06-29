import { expect, it } from 'vitest'
import {
  commandHistoryReducer as reduce,
  initialCommandHistory,
} from './history'
it('preserves drafts, edits and navigation boundaries without executing commands', () => {
  let state = initialCommandHistory
  for (const value of ['pwd', 'ls']) {
    state = reduce(state, { type: 'edit', value })
    state = reduce(state, { type: 'submit' })
  }
  state = reduce(state, { type: 'edit', value: 'unfinished' })
  state = reduce(state, { type: 'navigate', direction: 'up' })
  expect(state.draft).toBe('ls')
  state = reduce(state, { type: 'navigate', direction: 'up' })
  state = reduce(state, { type: 'navigate', direction: 'up' })
  expect(state.draft).toBe('pwd')
  for (let i = 0; i < 3; i++)
    state = reduce(state, { type: 'navigate', direction: 'down' })
  expect(state.draft).toBe('unfinished')
  state = reduce(state, { type: 'navigate', direction: 'up' })
  state = reduce(state, { type: 'edit', value: 'ls Documents' })
  state = reduce(state, { type: 'navigate', direction: 'up' })
  state = reduce(state, { type: 'navigate', direction: 'down' })
  expect(state.draft).toBe('ls Documents')
  expect(state.entries).toEqual(['pwd', 'ls'])
})
it('bounds history by count, text budget and input length, excluding blanks and adjacent duplicates', () => {
  let state = initialCommandHistory
  state = reduce(state, { type: 'edit', value: '  ' })
  expect(reduce(state, { type: 'submit' })).toBe(state)
  for (let i = 0; i < 60; i++) {
    state = reduce(state, { type: 'edit', value: `echo ${i}` })
    state = reduce(state, { type: 'submit' })
  }
  expect(state.entries).toHaveLength(50)
  expect(state.entries[0]).toBe('echo 10')
  state = reduce(state, { type: 'edit', value: 'echo 59' })
  state = reduce(state, { type: 'submit' })
  expect(state.entries).toHaveLength(50)
  for (let i = 0; i < 10; i++) {
    state = reduce(state, { type: 'edit', value: `${i}${'x'.repeat(5000)}` })
    expect(state.draft).toHaveLength(4096)
    state = reduce(state, { type: 'submit' })
  }
  expect(
    state.entries.reduce((sum, entry) => sum + entry.length, 0),
  ).toBeLessThanOrEqual(32000)
  expect(state.entries.at(-1)?.startsWith('9')).toBe(true)
})
