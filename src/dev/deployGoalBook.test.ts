import { describe, expect, it, vi } from 'vitest'
import { deployGoalBook } from './deployGoalBook'

const account = '0x292A2d9C3692E96d0255A353b5e22A38b297d785' as const
const deployed = '0x1234567890123456789012345678901234567890' as const
const bytecode = '0x6080deploy' as const
const runtime = '0x6080runtime' as const
const hash = `0x${'d'.repeat(64)}` as const

function fakes(overrides: Record<string, unknown> = {}) {
  const client = {
    getChainId: vi.fn(async () => 5042),
    getBalance: vi.fn(async () => 1_000_000_000_000_000_000n),
    estimateGas: vi.fn(async () => 1_000_000n),
    estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n })),
    waitForTransactionReceipt: vi.fn(async () => ({ status: 'success', contractAddress: deployed.toLowerCase() })),
    getCode: vi.fn(async () => runtime),
    ...overrides,
  }
  const wallet = { sendTransaction: vi.fn(async () => hash) }
  return { client, wallet }
}

describe('deployGoalBook', () => {
  it('deploys the tested bytecode at the Arc fee floor and confirms the code on chain', async () => {
    const { client, wallet } = fakes()
    const onSent = vi.fn()
    await expect(
      deployGoalBook({ client: client as never, wallet: wallet as never, account, bytecode, runtime, onSent }),
    ).resolves.toEqual({ hash, address: deployed })
    expect(wallet.sendTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ account, data: bytecode, gas: 1_200_001n, maxFeePerGas: 21_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
    )
    expect(onSent).toHaveBeenCalledWith(hash)
  })

  it('stops on another network, too little USDC for gas, a failed deployment or different code', async () => {
    const run = (overrides: Record<string, unknown>) => {
      const { client, wallet } = fakes(overrides)
      return deployGoalBook({ client: client as never, wallet: wallet as never, account, bytecode, runtime, onSent: vi.fn() })
    }
    await expect(run({ getChainId: async () => 1 })).rejects.toThrow('Arc mainnet')
    await expect(run({ getBalance: async () => 1n })).rejects.toThrow('Not enough USDC for gas')
    await expect(run({ waitForTransactionReceipt: async () => ({ status: 'reverted', contractAddress: null }) })).rejects.toThrow(
      'Deployment failed',
    )
    await expect(run({ getCode: async () => '0x6000' })).rejects.toThrow('does not match the tested GoalBook build')
  })
})
