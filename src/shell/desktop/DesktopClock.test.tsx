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

it('keeps one minute timer under StrictMode and releases it on every unmount', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-06T12:00:30Z'))
  for (let cycle = 0; cycle < 5; cycle++) {
    const mounted = render(
      <StrictMode>
        <DesktopClock />
      </StrictMode>,
    )
    expect(vi.getTimerCount()).toBe(1)
    const before = mounted.container.querySelector('time')!.dateTime
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(mounted.container.querySelector('time')!.dateTime).not.toBe(before)
    expect(vi.getTimerCount()).toBe(1)
    mounted.unmount()
    expect(vi.getTimerCount()).toBe(0)
  }
})
