// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, pad } from 'viem'
import type { Hex } from 'viem'
import { checkVault, configuredBook, goalEvents, prepareTransaction, publicClient, sendTransaction } from './chain'
import { GOAL_BOOK_RUNTIME_CODE } from './goalBookCode'
import { depositCalls, goalBookAbi, MULTICALL3_FROM, multicallFromAbi } from './goals'
import { ARC_EURC, ARC_USDC } from './vaults'
import type { Vault } from './vaults'

const book = '0x9999999999999999999999999999999999999999' as const
const owner = '0x7777777777777777777777777777777777777777' as const
const vault = '0x8888888888888888888888888888888888888888' as const
const usdcCalls = depositCalls({ book, vault, token: ARC_USDC, owner, amount: 1_000_000n })
const usdcSpend = { token: ARC_USDC, symbol: 'USDC', amount: 1_000_000n }

function onArc({ native = 2_000_000_000_000_000_000n, gas = 100_000n } = {}) {
  vi.stubEnv('VITE_GOAL_BOOK_ADDRESS', book)
  vi.spyOn(publicClient, 'getChainId').mockResolvedValue(5042)
  vi.spyOn(publicClient, 'getCode').mockResolvedValue(GOAL_BOOK_RUNTIME_CODE)
  vi.spyOn(publicClient, 'getBalance').mockResolvedValue(native)
  vi.spyOn(publicClient, 'estimateFeesPerGas').mockResolvedValue({
    maxFeePerGas: 10_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
  })
  return vi.spyOn(publicClient, 'estimateGas').mockResolvedValue(gas)
}

afterEach(() => {
  delete window.ethereum
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('configuredBook', () => {
  it('reads the GoalBook address from the build environment', () => {
    vi.stubEnv('VITE_GOAL_BOOK_ADDRESS', book)
    expect(configuredBook()).toBe(book)
    vi.stubEnv('VITE_GOAL_BOOK_ADDRESS', '')
    expect(() => configuredBook()).toThrow('not configured')
  })
})

describe('prepareTransaction', () => {
  it('estimates one Multicall3From call and reserves gas at the Arc fee floor', async () => {
    const estimate = onArc()
    const quote = await prepareTransaction({ account: owner, calls: usdcCalls, spend: usdcSpend })
    expect(quote.gasLimit).toBe(120_001n)
    expect(quote.maxFeePerGas).toBe(21_000_000_000n)
    expect(quote.maxNetworkFee).toBe(120_001n * 21_000_000_000n)
    const [{ to, data, account }] = estimate.mock.calls[0] as [{ to: string; data: `0x${string}`; account: string }]
    expect({ to, account }).toEqual({ to: MULTICALL3_FROM, account: owner })
    expect(decodeFunctionData({ abi: multicallFromAbi, data }).args).toEqual([usdcCalls])
  })

  it('refuses a deposit the wallet cannot cover, counting gas for USDC', async () => {
    const estimate = onArc({ native: 999_999_999_999_999_999n })
    await expect(prepareTransaction({ account: owner, calls: usdcCalls, spend: usdcSpend })).rejects.toThrow(
      'Not enough USDC',
    )
    expect(estimate).not.toHaveBeenCalled()

    vi.spyOn(publicClient, 'getBalance').mockResolvedValue(1_000_000_000_000_000_000n)
    await expect(prepareTransaction({ account: owner, calls: usdcCalls, spend: usdcSpend })).rejects.toThrow(
      'including gas',
    )

    vi.spyOn(publicClient, 'readContract').mockResolvedValue(999_999n)
    const eurcSpend = { token: ARC_EURC, symbol: 'EURC', amount: 1_000_000n }
    await expect(prepareTransaction({ account: owner, calls: usdcCalls, spend: eurcSpend })).rejects.toThrow(
      'Not enough EURC: need 1, wallet has 0.999999',
    )
  })

  it('refuses another network or a GoalBook address with different code', async () => {
    onArc()
    vi.spyOn(publicClient, 'getChainId').mockResolvedValue(1)
    await expect(prepareTransaction({ account: owner, calls: usdcCalls })).rejects.toThrow('not connected to Arc mainnet')
    vi.spyOn(publicClient, 'getChainId').mockResolvedValue(5042)
    vi.spyOn(publicClient, 'getCode').mockResolvedValue('0x6000')
    await expect(prepareTransaction({ account: owner, calls: usdcCalls })).rejects.toThrow('verified contract bytecode')
  })
})

describe('checkVault', () => {
  const listed: Vault = {
    address: vault,
    name: 'Steakhouse Prime USDC',
    asset: 'USDC',
    assetAddress: ARC_USDC,
    curator: null,
    apy: 0.01,
    apy30d: null,
    totalDeposits: 10_000,
    liquidity: 10_000,
    status: 'active',
    circleSentinel: true,
    warnings: [],
    collateral: [],
  }

  it('confirms on chain that the vault holds the token the list says it does', async () => {
    const read = vi.spyOn(publicClient, 'readContract').mockResolvedValue(ARC_USDC)
    await expect(checkVault(listed)).resolves.toBeUndefined()
    read.mockResolvedValue(ARC_EURC)
    await expect(checkVault(listed)).rejects.toThrow('does not hold Arc USDC')
  })
})

describe('sendTransaction', () => {
  it('sends the reviewed calls through Multicall3From with the quoted gas and fee caps', async () => {
    onArc()
    vi.spyOn(publicClient, 'waitForTransactionReceipt').mockResolvedValue({ status: 'reverted', logs: [] } as never)
    let sent: Array<Record<string, string>> = []
    const hash = `0x${'f'.repeat(64)}`
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      value: {
        request: async ({ method, params }: { method: string; params?: unknown }) => {
          if (method === 'eth_accounts') return [owner]
          if (method === 'wallet_switchEthereumChain') return null
          if (method === 'eth_chainId') return '0x13b2'
          if (method === 'eth_sendTransaction') {
            sent = params as Array<Record<string, string>>
            return hash
          }
          throw new Error(`Unexpected wallet RPC: ${method}`)
        },
      },
    })
    const quote = await prepareTransaction({ account: owner, calls: usdcCalls, spend: usdcSpend })
    const onSubmitted = vi.fn()

    await expect(sendTransaction(quote, onSubmitted)).rejects.toThrow('reverted')
    expect(onSubmitted).toHaveBeenCalledWith(hash)
    expect(sent[0]).toMatchObject({ from: owner, to: MULTICALL3_FROM, gas: '0x1d4c1', maxFeePerGas: '0x4e3b29200' })
    expect(decodeFunctionData({ abi: multicallFromAbi, data: sent[0].data as `0x${string}` }).args).toEqual([usdcCalls])
  })
})

describe('goalEvents', () => {
  it('reads what GoalBook recorded for this wallet', () => {
    const topics = encodeEventTopics({ abi: goalBookAbi, eventName: 'DepositRecorded', args: { owner, vault } }) as [Hex, ...Hex[]]
    const mine = { address: book, topics, data: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [5n, 7n]) }
    const someoneElse = { ...mine, topics: [topics[0], pad(vault), topics[2]] as [Hex, ...Hex[]] }
    const elsewhere = { ...mine, address: vault }
    expect(goalEvents({ logs: [elsewhere, someoneElse, mine] }, book, owner)).toEqual([
      { eventName: 'DepositRecorded', vault, amount: 5n, deposited: 7n },
    ])
    const removed = {
      address: book,
      topics: encodeEventTopics({ abi: goalBookAbi, eventName: 'GoalRemoved', args: { owner, vault } }) as [Hex, ...Hex[]],
      data: '0x' as Hex,
    }
    expect(goalEvents({ logs: [removed] }, book, owner)).toEqual([{ eventName: 'GoalRemoved', vault }])
  })
})
