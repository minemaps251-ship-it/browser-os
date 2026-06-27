import { VFS_LIMITS } from '../../core/filesystem/policy'
import styles from './StorageHelp.module.css'
export function StorageHelp() {
  return (
    <details className={styles.help}>
      <summary>Storage and recovery</summary>
      <p>
        Your saved workspace belongs to this site in this browser profile.
        Another browser, profile or device has a separate workspace.
      </p>
      <ul>
        <li>
          Up to {VFS_LIMITS.maxFileBytes / (1024 * 1024)} MiB of text per file.
        </li>
        <li>
          Up to {VFS_LIMITS.maxTotalBytes / (1024 * 1024)} MiB of text across
          all files.
        </li>
        <li>
          Up to {VFS_LIMITS.maxNodes.toLocaleString('en-US')} files and folders
          combined, including workspace folders.
        </li>
      </ul>
      <p>
        Browser storage is not a backup. Clearing this site’s data removes saved
        files and settings; the browser may also remove site data. Keep separate
        copies of important files. Backup export and import are not available
        yet.
      </p>
      <p>
        A temporary workspace keeps changes only in this tab until reload or
        close. Choosing it does not replace or repair the saved workspace.
      </p>
    </details>
  )
}
