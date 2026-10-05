// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as chain from './lib/chain'
import * as goals from './lib/goals'
import * as vaults from './lib/vaults'
import { newGoalCalls, withdrawCalls } from './lib/goals'
import type { GoalView } from './lib/goals'
import { ARC_USDC } from './lib/vaults'
import type { Vault } from './lib/vaults'
import App from './App'

const owner = '0x7777777777777777777777777777777777777777' as const
const book = '0x9999999999999999999999999999999999999999' as const
const payee = '0x6666666666666666666666666666666666666666' as const
const hash = `0x${'a'.repeat(64)}` as const

const steakhouse: Vault = {
  address: '0x8888888888888888888888888888888888888888',
  name: 'Steakhouse Prime USDC',
  asset: 'USDC',
  assetAddress: ARC_USDC,
  curator: 'Steakhouse Financial',
  apy: 0.0122,
  apy30d: 0.0008,
  totalDeposits: 2_585_079.81,
  liquidity: 265.63,
  status: 'low_liquidity',
  circleSentinel: true,
  warnings: ['low_liquidity'],
  collateral: ['cirBTC'],
}

const rent: GoalView = {
  vault: steakhouse.address,
  deadline: 0n,
  createdAt: 1n,
  target: 500_000_000n,
  deposited: 100_000_000n,
  name: 'Rent buffer',
  shares: 99_000_000_000_000_000_000n,
  value: 101_250_000n,
}

function quoteFrom(input: Parameters<typeof chain.prepareTransaction>[0]) {
  return { ...input, gasLimit: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 0n, maxNetworkFee: 4_000_000_000_000_000n }
}

beforeEach(() => {
  vi.spyOn(vaults, 'loadVaults').mockResolvedValue([steakhouse])
  vi.spyOn(chain, 'configuredBook').mockReturnValue(book)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

function connected(goalsAfterConnect: GoalView[][]) {
  vi.spyOn(chain, 'connectWallet').mockResolvedValue(owner)
  const load = vi.spyOn(goals, 'loadGoals')
  for (const list of goalsAfterConnect) load.mockResolvedValueOnce(list)
  vi.spyOn(chain, 'checkVault').mockResolvedValue()
  const prepare = vi.spyOn(chain, 'prepareTransaction').mockImplementation(async (input) => quoteFrom(input))
  const send = vi.spyOn(chain, 'sendTransaction').mockImplementation(async (_quote, onSubmitted) => {
    onSubmitted(hash)
    return { status: 'success', logs: [] } as never
  })
  return { load, prepare, send }
}

describe('Arc Goalmark', () => {
  it('lists Arc vaults from Earn Kit with the details a saver needs', async () => {
    render(<App />)
    const row = (await screen.findByText('Steakhouse Prime USDC')).closest('tr') as HTMLElement
    expect(within(row).getByText('Steakhouse Financial')).toBeTruthy()
    expect(within(row).getByText('1.22%')).toBeTruthy()
    expect(within(row).getByText(/low liquidity/i)).toBeTruthy()
    expect(within(row).getByText(/covered by circle sentinel/i)).toBeTruthy()
  })

  it('creates a goal and makes the first deposit in one reviewed transaction', async () => {
    const { prepare, send, load } = connected([[], [rent]])
    vi.spyOn(chain, 'goalEvents').mockReturnValue([
      { eventName: 'GoalSet', vault: steakhouse.address, name: 'Rent buffer', target: 500_000_000n, deadline: 0n },
      { eventName: 'DepositRecorded', vault: steakhouse.address, amount: 1_000_000n, deposited: 1_000_000n },
    ])
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /connect wallet/i }))
    await screen.findByText(/no goals yet/i)
    fireEvent.change(screen.getByLabelText(/goal name/i), { target: { value: 'Rent buffer' } })
    fireEvent.change(screen.getByLabelText(/target amount/i), { target: { value: '500' } })
    await user.click(await screen.findByRole('radio', { name: /steakhouse prime usdc/i }))
    fireEvent.change(screen.getByLabelText(/first deposit/i), { target: { value: '1' } })
    await user.click(screen.getByRole('button', { name: /review goal/i }))

    expect(prepare).toHaveBeenCalledWith({
      account: owner,
      calls: newGoalCalls({ book, vault: steakhouse.address, token: ARC_USDC, owner, name: 'Rent buffer', target: 500_000_000n, deadline: 0n, amount: 1_000_000n }),
      spend: { token: ARC_USDC, symbol: 'USDC', amount: 1_000_000n },
    })
    expect(screen.getByText(/network fee up to 0.004 USDC/i)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /create goal/i }))

    expect(send).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Rent buffer' })).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shows progress and interest, and pays someone straight from a goal', async () => {
    const { prepare, send } = connected([[rent], [rent]])
    vi.spyOn(chain, 'goalEvents').mockReturnValue([
      { eventName: 'WithdrawalRecorded', vault: steakhouse.address, amount: 500_000n, deposited: 99_500_000n },
    ])
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /connect wallet/i }))
    const card = (await screen.findByRole('heading', { name: 'Rent buffer' })).closest('article') as HTMLElement
    expect(within(card).getByText('20%')).toBeTruthy()
    expect(within(card).getByText('1.25 USDC')).toBeTruthy()
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('20')

    await user.click(within(card).getByRole('button', { name: /pay from goal/i }))
    fireEvent.change(within(card).getByLabelText(/pay to address/i), { target: { value: payee } })
    fireEvent.change(within(card).getByLabelText(/^amount/i), { target: { value: '0.5' } })
    await user.click(within(card).getByRole('button', { name: /review/i }))
    expect(prepare).toHaveBeenCalledWith({
      account: owner,
      calls: withdrawCalls({ book, vault: steakhouse.address, owner, receiver: payee, amount: 500_000n }),
    })
    await user.click(within(card).getByRole('button', { name: /confirm/i }))
    expect(send).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/paid 0.50 USDC/i))
  })

  it('shows a shared goal read-only from the chain', async () => {
    window.history.replaceState(null, '', `/?owner=${owner}&vault=${steakhouse.address}`)
    vi.spyOn(goals, 'loadGoal').mockResolvedValue(rent)
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Rent buffer' })).toBeTruthy()
    expect(screen.getByText(/shared goal/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /add money/i })).toBeNull()
  })

  it('explains plainly where the money goes and what can go wrong', () => {
    render(<App />)
    expect(screen.getByText(/never holds your money/i)).toBeTruthy()
    expect(screen.getAllByText(/morpho vaults/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/can lose money/i)).toBeTruthy()
  })

  it('says so when there is no browser wallet', async () => {
    render(<App />)
    await userEvent.setup().click(screen.getByRole('button', { name: /connect wallet/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/no browser wallet detected/i)
  })
})
