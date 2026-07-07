import { StorageHelp } from '../../shared/ui/StorageHelp'
import styles from './AboutApp.module.css'
export default function AboutApp() {
  return (
    <div className={styles.content}>
      <span className={styles.eyebrow}>GET STARTED</span>
      <h2>A desktop, built for the browser.</h2>
      <p>
        Open Notes to write a document, then save it with a name. You can find
        it in Files and read the same saved text in Terminal.
      </p>
      <div className={styles.facts}>
        <div>
          <strong>Files</strong>
          <p>Browse folders, create files and choose an editor.</p>
        </div>
        <div>
          <strong>Code Editor</strong>
          <p>Edit source files, search text and save your changes.</p>
        </div>
        <div>
          <strong>Terminal</strong>
          <p>Use ls to list files and cat to read saved text.</p>
        </div>
      </div>
      <p className={styles.note}>
        Settings lets you change the theme and download a JSON copy of your
        saved files. Save your edits before preparing an export.
      </p>
      <StorageHelp />
    </div>
  )
}
