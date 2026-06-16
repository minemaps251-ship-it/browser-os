import { useEffect, useState } from 'react'
import styles from './DesktopClock.module.css'

const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})
const fullFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'short',
})

export function DesktopClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Keep updates here: the desktop and mounted apps don't subscribe to time.
    let timer: number
    function scheduleMinute() {
      timer = window.setTimeout(
        () => {
          setNow(new Date())
          scheduleMinute()
        },
        60_000 - (Date.now() % 60_000),
      )
    }
    scheduleMinute()
    return () => window.clearTimeout(timer)
  }, [])
  return (
    <time
      className={styles.clock}
      dateTime={now.toISOString()}
      aria-label={fullFormat.format(now)}
    >
      <span className={styles.date}>{dateFormat.format(now)}</span>
      <span>{timeFormat.format(now)}</span>
    </time>
  )
}
