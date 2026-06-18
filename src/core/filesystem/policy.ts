import type { NodeId } from './types'

export const ROOT_NODE_ID = 'vfs-root' as NodeId

// Proposed demo budgets. Atomic enforcement arrives with repository mutations.
export const VFS_LIMITS = Object.freeze({
  maxNameCodePoints: 255,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 10 * 1024 * 1024,
  maxNodes: 2000,
})

// Specifications only: no seed runs during render, parsing or module import.
// Documents/Desktop are ordinary user directories; root/home/user/system stay put.
export const INITIAL_DIRECTORIES = Object.freeze([
  Object.freeze({ path: '/', protected: true }),
  Object.freeze({ path: '/home', protected: true }),
  Object.freeze({ path: '/home/user', protected: true }),
  Object.freeze({ path: '/home/user/Documents', protected: false }),
  Object.freeze({ path: '/home/user/Desktop', protected: false }),
  Object.freeze({ path: '/system', protected: true }),
])
