import styles from './DesktopWallpaper.module.css'

export function DesktopWallpaper() {
  return (
    <svg
      className={styles.wallpaper}
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="1600" height="1000" fill="var(--wallpaper-base)" />
      <path
        d="M-250 1000C-70 640 150 520 440 590S790 550 810 340 1050 0 1450-180L1900 1000Z"
        fill="var(--wallpaper-rear)"
      />
      <path
        d="M-200 1050C60 600 320 860 610 700S860 440 1090 370 1490 400 1820 40L1820 1050Z"
        fill="var(--wallpaper-middle)"
      />
      <path
        d="M-120 1090C250 670 470 1080 850 770S1250 780 1690 430L1700 1100Z"
        fill="var(--wallpaper-front)"
      />
      <path
        d="M-80 1050C260 860 570 1100 900 940S1380 840 1680 670L1680 1100Z"
        fill="var(--wallpaper-edge)"
      />
    </svg>
  )
}
