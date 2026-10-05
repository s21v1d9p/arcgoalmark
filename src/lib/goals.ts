import { encodeFunctionData, maxUint256, parseAbi } from 'viem'
import type { Address, Hex } from 'viem'

// Arc predeploy that runs each call with the signing wallet as msg.sender.
export const MULTICALL3_FROM = '0x522fAf9A91c41c443c66765030741e4AaCe147D0' as const

export const goalBookAbi = parseAbi([
  'struct Goal { address vault; uint64 deadline; uint64 createdAt; uint256 target; uint256 deposited; string name; }',
  'function goalsOf(address owner) view returns (Goal[])',
  'function goalOf(address owner, address vault) view returns (Goal)',
  'function setGoal(address vault, string name, uint256 target, uint64 deadline)',
  'function removeGoal(address vault)',
  'function recordDeposit(address vault, uint256 amount)',
  'function recordWithdrawal(address vault, uint256 amount)',
  'event GoalSet(address indexed owner, address indexed vault, string name, uint256 target, uint64 deadline)',
  'event GoalRemoved(address indexed owner, address indexed vault)',
  'event DepositRecorded(address indexed owner, address indexed vault, uint256 amount, uint256 deposited)',
  'event WithdrawalRecorded(address indexed owner, address indexed vault, uint256 amount, uint256 deposited)',
])

export const vaultAbi = parseAbi([
  'function asset() view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
])

export const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
])

export const multicallFromAbi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) returns (Result[])',
])

export type Call = { target: Address; allowFailure: false; callData: Hex }

type Accounts = { book: Address; vault: Address; owner: Address }

function call(target: Address, callData: Hex): Call {
  return { target, allowFailure: false, callData }
}

export function depositCalls({ book, vault, token, owner, amount }: Accounts & { token: Address; amount: bigint }): Call[] {
  return [
    call(token, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [vault, amount] })),
    call(vault, encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [amount, owner] })),
    call(book, encodeFunctionData({ abi: goalBookAbi, functionName: 'recordDeposit', args: [vault, amount] })),
  ]
}

export function newGoalCalls({
  book,
  vault,
  token,
  owner,
  name,
  target,
  deadline,
  amount,
}: Accounts & { token: Address; name: string; target: bigint; deadline: bigint; amount: bigint }): Call[] {
  const setGoal = call(book, encodeFunctionData({ abi: goalBookAbi, functionName: 'setGoal', args: [vault, name, target, deadline] }))
  return amount > 0n ? [setGoal, ...depositCalls({ book, vault, token, owner, amount })] : [setGoal]
}

export function withdrawCalls({ book, vault, owner, receiver, amount }: Accounts & { receiver: Address; amount: bigint }): Call[] {
  return [
    call(vault, encodeFunctionData({ abi: vaultAbi, functionName: 'withdraw', args: [amount, receiver, owner] })),
    call(book, encodeFunctionData({ abi: goalBookAbi, functionName: 'recordWithdrawal', args: [vault, amount] })),
  ]
}

// Redeeming every share avoids leaving dust behind; the goal record is cleared in the same transaction.
export function withdrawAllCalls({ book, vault, owner, receiver, shares }: Accounts & { receiver: Address; shares: bigint }): Call[] {
  return [
    call(vault, encodeFunctionData({ abi: vaultAbi, functionName: 'redeem', args: [shares, receiver, owner] })),
    call(book, encodeFunctionData({ abi: goalBookAbi, functionName: 'recordWithdrawal', args: [vault, maxUint256] })),
  ]
}

export function removeGoalCalls({ book, vault }: { book: Address; vault: Address }): Call[] {
  return [call(book, encodeFunctionData({ abi: goalBookAbi, functionName: 'removeGoal', args: [vault] }))]
}

export function goalProgress(goal: { target: bigint; deposited: bigint }, value: bigint) {
  const basisPoints = goal.target === 0n ? 0n : (value * 10_000n) / goal.target
  return {
    percent: Math.min(Number(basisPoints) / 100, 100),
    interest: value > goal.deposited ? value - goal.deposited : 0n,
  }
}

type GoalRecord = { vault: Address; deadline: bigint; createdAt: bigint; target: bigint; deposited: bigint; name: string }
export type GoalView = GoalRecord & { shares: bigint; value: bigint }

export type Reader = {
  readContract(parameters: { address: Address; abi: unknown; functionName: string; args?: readonly unknown[] }): Promise<unknown>
}

async function withValue(client: Reader, owner: Address, goal: GoalRecord): Promise<GoalView> {
  const shares = (await client.readContract({ address: goal.vault, abi: vaultAbi, functionName: 'balanceOf', args: [owner] })) as bigint
  const value =
    shares === 0n
      ? 0n
      : ((await client.readContract({ address: goal.vault, abi: vaultAbi, functionName: 'convertToAssets', args: [shares] })) as bigint)
  return { ...goal, shares, value }
}

export async function loadGoals(client: Reader, book: Address, owner: Address): Promise<GoalView[]> {
  const goals = (await client.readContract({ address: book, abi: goalBookAbi, functionName: 'goalsOf', args: [owner] })) as readonly GoalRecord[]
  return Promise.all(goals.map((goal) => withValue(client, owner, goal)))
}

export async function loadGoal(client: Reader, book: Address, owner: Address, vault: Address): Promise<GoalView | null> {
  let goal: GoalRecord
  try {
    goal = (await client.readContract({ address: book, abi: goalBookAbi, functionName: 'goalOf', args: [owner, vault] })) as GoalRecord
  } catch (cause) {
    if (String(cause).includes('UnknownGoal')) return null
    throw cause
  }
  return withValue(client, owner, goal)
}
