import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  zeroAddress,
} from 'viem'
import type { Address, Hash, Hex } from 'viem'
import { arcFeeCaps } from './fees'
import { GOAL_BOOK_RUNTIME_CODE } from './goalBookCode'
import { erc20Abi, goalBookAbi, MULTICALL3_FROM, multicallFromAbi, vaultAbi } from './goals'
import type { Call, Reader } from './goals'
import { arcMainnet } from './networks'
import { arcMainnetTransport } from './rpc'
import { ARC_USDC } from './vaults'
import type { Vault } from './vaults'
import { connectToChain, injectedWallet, selectChain } from './wallet'

export { arcMainnet }

export const publicClient = createPublicClient({ chain: arcMainnet, transport: arcMainnetTransport() })

// loadGoals only needs plain contract reads; this narrows viem's strongly typed client to that.
export const goalReader: Reader = {
  readContract: (parameters) => publicClient.readContract(parameters as never),
}

export type Spend = { token: Address; symbol: string; amount: bigint }

export type Quote = {
  account: Address
  calls: Call[]
  spend?: Spend
  gasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  maxNetworkFee: bigint
}

export function configuredBook(): Address {
  const address = import.meta.env.VITE_GOAL_BOOK_ADDRESS
  if (!address || !isAddress(address) || address.toLowerCase() === zeroAddress) {
    throw new Error('GoalBook address is not configured yet')
  }
  return getAddress(address)
}

export async function connectWallet(): Promise<Address> {
  return connectToChain(arcMainnet)
}

async function checkGoalBook(book: Address): Promise<void> {
  if ((await publicClient.getChainId()) !== arcMainnet.id) {
    throw new Error('RPC is not connected to Arc mainnet')
  }
  const code = await publicClient.getCode({ address: book })
  if (!code || code === '0x') throw new Error('GoalBook is not deployed on Arc mainnet')
  if (code.toLowerCase() !== GOAL_BOOK_RUNTIME_CODE.toLowerCase()) {
    throw new Error('Configured GoalBook does not match the verified contract bytecode')
  }
}

export async function checkVault(vault: Vault): Promise<void> {
  const asset = await publicClient.readContract({ address: vault.address, abi: vaultAbi, functionName: 'asset' })
  if (asset.toLowerCase() !== vault.assetAddress.toLowerCase()) {
    throw new Error(`${vault.name} does not hold Arc ${vault.asset}`)
  }
}

export async function prepareTransaction({
  account,
  calls,
  spend,
}: {
  account: Address
  calls: Call[]
  spend?: Spend
}): Promise<Quote> {
  await checkGoalBook(configuredBook())

  // On Arc the USDC token and the gas balance are the same money: 6 decimals as a token, 18 as gas.
  const native = await publicClient.getBalance({ address: account })
  const usdcSpend = spend?.token === ARC_USDC ? spend.amount * 10n ** 12n : 0n
  if (native < usdcSpend) {
    throw new Error(`Not enough USDC: need ${formatUnits(usdcSpend, 18)}, wallet has ${formatUnits(native, 18)}`)
  }
  if (spend && spend.token !== ARC_USDC) {
    const balance = await publicClient.readContract({
      address: spend.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account],
    })
    if (balance < spend.amount) {
      throw new Error(`Not enough ${spend.symbol}: need ${formatUnits(spend.amount, 6)}, wallet has ${formatUnits(balance, 6)}`)
    }
  }

  const data = encodeFunctionData({ abi: multicallFromAbi, functionName: 'aggregate3', args: [calls] })
  const gasEstimate = await publicClient.estimateGas({ account, to: MULTICALL3_FROM, data })
  const gasLimit = (gasEstimate * 120n) / 100n + 1n
  const { maxFeePerGas, maxPriorityFeePerGas } = arcFeeCaps(await publicClient.estimateFeesPerGas({ type: 'eip1559' }))
  const maxNetworkFee = gasLimit * maxFeePerGas
  if (native < usdcSpend + maxNetworkFee) {
    throw new Error(
      `Not enough USDC: need up to ${formatUnits(usdcSpend + maxNetworkFee, 18)} USDC including gas, wallet has ${formatUnits(native, 18)} USDC`,
    )
  }
  return { account, calls, spend, gasLimit, maxFeePerGas, maxPriorityFeePerGas, maxNetworkFee }
}

export async function sendTransaction(quote: Quote, onSubmitted: (hash: Hash) => void) {
  const client = createWalletClient({ chain: arcMainnet, transport: custom(injectedWallet()) })
  const [active] = await client.getAddresses()
  if (active?.toLowerCase() !== quote.account.toLowerCase()) {
    throw new Error('Wallet account changed. Reconnect and review again.')
  }
  await selectChain(arcMainnet)
  const current = await prepareTransaction(quote)
  const hash = await client.writeContract({
    account: quote.account,
    chain: arcMainnet,
    address: MULTICALL3_FROM,
    abi: multicallFromAbi,
    functionName: 'aggregate3',
    args: [quote.calls],
    gas: current.gasLimit,
    maxFeePerGas: current.maxFeePerGas,
    maxPriorityFeePerGas: current.maxPriorityFeePerGas,
  })
  onSubmitted(hash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success') throw new Error('Transaction reverted; nothing changed')
  return receipt
}

type GoalLog = { address: Address; data: Hex; topics: [] | [Hex, ...Hex[]] }

export type GoalEvent =
  | { eventName: 'GoalSet'; vault: Address; name: string; target: bigint; deadline: bigint }
  | { eventName: 'GoalRemoved'; vault: Address }
  | { eventName: 'DepositRecorded' | 'WithdrawalRecorded'; vault: Address; amount: bigint; deposited: bigint }

export function goalEvents(receipt: { logs: readonly GoalLog[] }, book: Address, owner: Address): GoalEvent[] {
  const events: GoalEvent[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== book.toLowerCase()) continue
    const event = decodeEventLog({ abi: goalBookAbi, topics: log.topics, data: log.data, strict: false })
    if (!('owner' in event.args) || event.args.owner?.toLowerCase() !== owner.toLowerCase()) continue
    const vault = getAddress(event.args.vault as Address)
    if (event.eventName === 'GoalSet') {
      const { name, target, deadline } = event.args
      events.push({ eventName: 'GoalSet', vault, name: name ?? '', target: target ?? 0n, deadline: BigInt(deadline ?? 0) })
    } else if (event.eventName === 'GoalRemoved') {
      events.push({ eventName: 'GoalRemoved', vault })
    } else if (event.eventName === 'DepositRecorded' || event.eventName === 'WithdrawalRecorded') {
      events.push({ eventName: event.eventName, vault, amount: event.args.amount ?? 0n, deposited: event.args.deposited ?? 0n })
    }
  }
  return events
}
