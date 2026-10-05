import { describe, expect, it } from 'vitest'
import { GOAL_BOOK_RUNTIME_CODE } from './goalBookCode'

const artifacts = import.meta.glob<string>('/artifacts/contracts/GoalBook.sol/GoalBook.json', {
  eager: true,
  import: 'deployedBytecode',
})

describe('pinned GoalBook runtime bytecode', () => {
  it('matches the current compiled contract and contains no coverage instrumentation', () => {
    const compiled = Object.values(artifacts)[0]
    expect(compiled, 'Run npm test so Hardhat compiles contracts first').toBeTypeOf('string')
    expect(compiled.toLowerCase()).toBe(GOAL_BOOK_RUNTIME_CODE.toLowerCase())
    expect(GOAL_BOOK_RUNTIME_CODE.toLowerCase()).not.toContain('c0bec0bec0bec0be')
  })
})
