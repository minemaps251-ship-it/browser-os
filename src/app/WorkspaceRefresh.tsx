import { useEffect } from 'react'
import type { RefreshService } from '../core/refresh/service'
import { bindRefreshVisibility } from './refreshVisibility'
export function WorkspaceRefresh({ refresh }: { refresh: RefreshService }) {
  useEffect(() => bindRefreshVisibility(refresh, document), [refresh])
  return null
}
