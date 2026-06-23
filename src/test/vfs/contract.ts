import { describe, it } from 'vitest'
import { vfsContractCases, runVfsContractCase } from './scenarios'
import type { VfsContractFactory } from './scenarios'
export type { VfsContractFactory, VfsContractFixture } from './scenarios'
export function defineVfsRepositoryContract(
  name: string,
  factory: VfsContractFactory,
) {
  describe(name + ' VFS repository contract', () => {
    for (const scenario of vfsContractCases)
      it(scenario.name, async () => {
        await runVfsContractCase(scenario.name, await factory())
      })
  })
}
