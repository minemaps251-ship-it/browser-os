import { StorageHelp } from '../../shared/ui/StorageHelp'
import styles from './AboutApp.module.css'
export default function AboutApp() {
  return (
    <div className={styles.content}>
      <span className={styles.eyebrow}>WELCOME TO YOUR WORKSPACE</span>
      <h2>A desktop, built for the browser.</h2>
      <p>
        BrowserOS explores how applications, windows, and shared services work
        together in a browser.
      </p>
      <div className={styles.facts}>
        <div>
          <span>01</span>
          <strong>Applications</strong>
          <p>Launch through a single registry.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Windows</strong>
          <p>Independent identity and focus.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Lifecycle</strong>
          <p>Open, focus, and close cleanly.</p>
        </div>
      </div>
      <p className={styles.note}>
        Your workspace and appearance are stored in this browser. Use Files to
        browse folders in your workspace.
      </p>
      <StorageHelp />
    </div>
  )
}
