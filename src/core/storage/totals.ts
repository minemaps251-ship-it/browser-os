import { VFS_LIMITS } from '../filesystem/policy'
import type { VfsResult } from '../filesystem/types'
import { corrupt } from './records'
import type { TotalsRecord } from './types'
export function decodeTotals(
  raw: unknown,
  actualCount: number,
  schema: unknown,
): VfsResult<TotalsRecord> {
  if (
    !schema ||
    typeof schema !== 'object' ||
    !('key' in schema) ||
    schema.key !== 'schema' ||
    !('version' in schema) ||
    schema.version !== 1
  )
    return corrupt('Invalid schema record.')
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('key' in raw) ||
    raw.key !== 'totals' ||
    !('nodeCount' in raw) ||
    raw.nodeCount !== actualCount ||
    actualCount < 1 ||
    actualCount > VFS_LIMITS.maxNodes ||
    !('textBytes' in raw) ||
    typeof raw.textBytes !== 'number' ||
    !Number.isSafeInteger(raw.textBytes) ||
    raw.textBytes < 0 ||
    raw.textBytes > VFS_LIMITS.maxTotalBytes
  )
    return corrupt('Invalid filesystem counters.')
  return {
    ok: true,
    value: { key: 'totals', nodeCount: actualCount, textBytes: raw.textBytes },
  }
}
