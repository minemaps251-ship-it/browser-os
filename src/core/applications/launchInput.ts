import type { NodeId } from '../filesystem/types'
export type ApplicationLaunchInput =
  | { readonly kind: 'default' }
  | { readonly kind: 'file'; readonly fileId: NodeId }
