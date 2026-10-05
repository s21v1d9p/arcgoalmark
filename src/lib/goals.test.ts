import { describe, expect, it } from 'vitest'
import { decodeFunctionData, maxUint256 } from 'viem'
import {
  depositCalls,
  erc20Abi,
  goalBookAbi,
  goalProgress,
  loadGoal,
  loadGoals,
  newGoalCalls,
  removeGoalCalls,
  vaultAbi,
  withdrawAllCalls,
  withdrawCalls,
} from './goals'
import type { Call } from './goals'
import { ARC_USDC } from './vaults'

const book = '0x9999999999999999999999999999999999999999' as const
const vault = '0x8888888888888888888888888888888888888888' as const
const owner = '0x7777777777777777777777777777777777777777' as const
const payee = '0x6666666666666666666666666666666666666666' as const

function decoded(calls: Call[]) {
  return calls.map((call) => {
    const abi = call.target === book ? goalBookAbi : call.target === ARC_USDC ? erc20Abi : vaultAbi
    const { functionName, args } = decodeFunctionData({ abi, data: call.callData })
    return { target: call.target, allowFailure: call.allowFailure, functionName, args }
  })
}

describe('goal transactions', () => {
  it('deposits with an exact approval and records the amount on the goal, all or nothing', () => {
    expect(decoded(depositCalls({ book, vault, token: ARC_USDC, owner, amount: 2_500_000n }))).toEqual([
      { target: ARC_USDC, allowFailure: false, functionName: 'approve', args: [vault, 2_500_000n] },
      { target: vault, allowFailure: false, functionName: 'deposit', args: [2_500_000n, owner] },
      { target: book, allowFailure: false, functionName: 'recordDeposit', args: [vault, 2_500_000n] },
    ])
  })

  it('creates a goal and funds it in the same transaction', () => {
    const calls = decoded(
      newGoalCalls({ book, vault, token: ARC_USDC, owner, name: 'Rent buffer', target: 500_000_000n, deadline: 0n, amount: 1_000_000n }),
    )
    expect(calls[0]).toEqual({
      target: book,
      allowFailure: false,
      functionName: 'setGoal',
      args: [vault, 'Rent buffer', 500_000_000n, 0n],
    })
    expect(calls.map((call) => call.functionName)).toEqual(['setGoal', 'approve', 'deposit', 'recordDeposit'])
    expect(newGoalCalls({ book, vault, token: ARC_USDC, owner, name: 'Later', target: 1n, deadline: 0n, amount: 0n })).toHaveLength(1)
  })

  it('withdraws straight to a payee or the saver and updates the goal record', () => {
    expect(decoded(withdrawCalls({ book, vault, owner, receiver: payee, amount: 400_000n }))).toEqual([
      { target: vault, allowFailure: false, functionName: 'withdraw', args: [400_000n, payee, owner] },
      { target: book, allowFailure: false, functionName: 'recordWithdrawal', args: [vault, 400_000n] },
    ])
    expect(decoded(withdrawAllCalls({ book, vault, owner, receiver: owner, shares: 987n }))).toEqual([
      { target: vault, allowFailure: false, functionName: 'redeem', args: [987n, owner, owner] },
      { target: book, allowFailure: false, functionName: 'recordWithdrawal', args: [vault, maxUint256] },
    ])
  })
})

describe('removing a goal', () => {
  it('only touches the goal book', () => {
    expect(decoded(removeGoalCalls({ book, vault }))).toEqual([
      { target: book, allowFailure: false, functionName: 'removeGoal', args: [vault] },
    ])
  })
})

describe('goal progress', () => {
  it('reports progress against the target and interest above what was put in', () => {
    expect(goalProgress({ target: 500_000_000n, deposited: 100_000_000n }, 101_250_000n)).toEqual({
      percent: 20.25,
      interest: 1_250_000n,
    })
    expect(goalProgress({ target: 100n, deposited: 0n }, 250n)).toEqual({ percent: 100, interest: 250n })
    expect(goalProgress({ target: 100n, deposited: 90n }, 80n)).toEqual({ percent: 80, interest: 0n })
  })

  it('reads every goal with its current value in the vault', async () => {
    const reads: string[] = []
    const client = {
      readContract: async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
        reads.push(`${functionName}@${address}`)
        if (functionName === 'goalsOf') {
          return [{ vault, deadline: 0n, createdAt: 1n, target: 10_000_000n, deposited: 2_000_000n, name: 'Rent' }]
        }
        if (functionName === 'balanceOf') return 1_900_000_000_000_000_000n
        if (functionName === 'convertToAssets') return args?.[0] === 1_900_000_000_000_000_000n ? 2_010_000n : 0n
        throw new Error(`unexpected ${functionName}`)
      },
    }
    const [goal] = await loadGoals(client, book, owner)
    expect(goal).toMatchObject({ name: 'Rent', vault, shares: 1_900_000_000_000_000_000n, value: 2_010_000n })
    expect(reads).toEqual([`goalsOf@${book}`, `balanceOf@${vault}`, `convertToAssets@${vault}`])
  })

  it('reads one shared goal, or nothing when that wallet has no goal for the vault', async () => {
    const record = { vault, deadline: 0n, createdAt: 1n, target: 10_000_000n, deposited: 0n, name: 'Trip' }
    const client = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === 'goalOf') return record
        if (functionName === 'balanceOf') return 0n
        throw new Error(`unexpected ${functionName}`)
      },
    }
    await expect(loadGoal(client, book, owner, vault)).resolves.toEqual({ ...record, shares: 0n, value: 0n })
    const missing = {
      readContract: async () => {
        throw new Error('The contract function "goalOf" reverted. Error: UnknownGoal()')
      },
    }
    await expect(loadGoal(missing, book, owner, vault)).resolves.toBeNull()
    const broken = {
      readContract: async () => {
        throw new Error('fetch failed')
      },
    }
    await expect(loadGoal(broken, book, owner, vault)).rejects.toThrow('fetch failed')
  })
})
