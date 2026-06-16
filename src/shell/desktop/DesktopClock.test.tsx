import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopClock } from './DesktopClock'

afterEach(() => vi.useRealTimers())

it('updates at the next minute and cleans its only timer under StrictMode', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-02T10:47:20Z'))
  const { unmount } = render(
    <StrictMode>
      <DesktopClock />
    </StrictMode>,
  )
  const clock = screen.getByRole('time')
  expect(clock).toHaveAttribute('datetime', '2026-10-02T10:47:20.000Z')
  expect(clock).toHaveAccessibleName()
  expect(vi.getTimerCount()).toBe(1)
  act(() => vi.advanceTimersByTime(40_000))
  expect(clock).toHaveAttribute('datetime', '2026-10-02T10:48:00.000Z')
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
