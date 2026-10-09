import { useState } from 'react'
import { getAddress, isAddress, zeroAddress } from 'viem'
import type { Address } from 'viem'
import { formatAmount, parseAmount } from '../lib/amounts'
import { depositCalls, goalProgress, removeGoalCalls, withdrawAllCalls, withdrawCalls } from '../lib/goals'
import type { GoalView } from '../lib/goals'
import type { Vault } from '../lib/vaults'
import { percent, ReviewNote, SendingNote, shortAddress } from './format'
import { useTransaction } from './useTransaction'
import type { Plan } from './useTransaction'

type Mode = 'add' | 'withdraw' | 'pay' | 'remove'

type Props = {
  goal: GoalView
  vault: Vault | undefined
  account: Address | null
  book: Address
  shared?: boolean
  onChanged?: (message: string) => void
}

export function deadlineLabel(deadline: bigint): string | null {
  if (deadline === 0n) return null
  return new Date(Number(deadline) * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function payeeAddress(text: string): Address {
  const value = text.trim()
  if (!isAddress(value) || value.toLowerCase() === zeroAddress) throw new Error('Enter the wallet address to pay')
  return getAddress(value)
}

export function GoalCard({ goal, vault, account, book, shared = false, onChanged }: Props) {
  const [mode, setMode] = useState<Mode | null>(null)
  const [amount, setAmount] = useState('')
  const [payee, setPayee] = useState('')
  const [everything, setEverything] = useState(false)
  const [reviewedDraft, setReviewedDraft] = useState('')
  const tx = useTransaction(account)
  const asset = vault?.asset ?? 'USDC'
  const { percent: progress, interest } = goalProgress(goal, goal.value)
  const filled = Math.floor(progress)
  const due = deadlineLabel(goal.deadline)
  const draft = JSON.stringify([mode, amount, payee, everything])
  const reviewed = tx.quote !== null && reviewedDraft === draft

  function open(next: Mode) {
    tx.reset()
    setMode(mode === next ? null : next)
    setAmount('')
    setPayee('')
    setEverything(false)
  }

  function plan(): Plan {
    if (!account) throw new Error('Connect the wallet that owns this goal')
    if (mode === 'remove') return { calls: removeGoalCalls({ book, vault: goal.vault }) }
    if (mode === 'add') {
      if (!vault) throw new Error('This vault is not listed by Earn Kit right now, so new deposits are paused')
      const units = parseAmount(amount)
      return {
        calls: depositCalls({ book, vault: goal.vault, token: vault.assetAddress, owner: account, amount: units }),
        spend: { token: vault.assetAddress, symbol: vault.asset, amount: units },
        vault,
      }
    }
    const receiver = mode === 'pay' ? payeeAddress(payee) : account
    if (mode === 'withdraw' && everything) {
      if (goal.shares === 0n) throw new Error('There is nothing in this goal yet')
      return { calls: withdrawAllCalls({ book, vault: goal.vault, owner: account, receiver, shares: goal.shares }) }
    }
    return { calls: withdrawCalls({ book, vault: goal.vault, owner: account, receiver, amount: parseAmount(amount) }) }
  }

  async function review() {
    if (await tx.review(plan)) setReviewedDraft(draft)
  }

  async function confirm() {
    const expected = mode === 'add' ? 'DepositRecorded' : mode === 'remove' ? 'GoalRemoved' : 'WithdrawalRecorded'
    const done = await tx.confirm((events) => events.some((event) => event.eventName === expected && event.vault === goal.vault))
    if (!done) return
    const sum = amount.trim() ? `${formatAmount(parseAmount(amount))} ${asset}` : ''
    const message =
      mode === 'add'
        ? `Added ${sum} to ${goal.name}.`
        : mode === 'pay'
        ? `Paid ${sum} to ${shortAddress(payee.trim())} from ${goal.name}.`
        : mode === 'remove'
        ? `Removed ${goal.name}.`
        : everything
        ? `Took everything out of ${goal.name}.`
        : `Took ${sum} out of ${goal.name}.`
    setMode(null)
    onChanged?.(message)
  }

  async function copyShareLink() {
    if (!account) return
    const link = `${window.location.origin}${window.location.pathname}?owner=${account}&vault=${goal.vault}`
    try {
      await navigator.clipboard.writeText(link)
      onChanged?.('Share link copied. Anyone with it can see this goal, read from Arc.')
    } catch {
      onChanged?.(`Share link: ${link}`)
    }
  }

  return (
    <article className="goal-card">
      <div className="ribbon" role="progressbar" aria-label={`${goal.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={filled}>
        <span className="ribbon-fill" style={{ height: `${Math.max(filled, 4)}%` }} />
      </div>
      <header className="goal-head">
        <span className="tab-label">{shared ? 'Shared goal' : due ? `By ${due}` : 'No date'}</span>
        <h3>{goal.name}</h3>
        <p className="goal-target">
          <span className="percent">{filled}%</span> of {formatAmount(goal.target)} {asset}
        </p>
      </header>
      <dl className="goal-figures">
        <div>
          <dt>Saved now</dt>
          <dd>{formatAmount(goal.value)} {asset}</dd>
        </div>
        <div>
          <dt>Interest earned</dt>
          <dd><strong>{formatAmount(interest)} {asset}</strong></dd>
        </div>
      </dl>
      <p className="goal-vault">
        Earning in {vault ? <strong>{vault.name}</strong> : <strong>{shortAddress(goal.vault)}</strong>}
        {vault ? ` · ${percent(vault.apy)} now${vault.curator ? ` · ${vault.curator}` : ''}` : ''}
        {vault?.status === 'low_liquidity' ? ' · low liquidity, withdrawals may fail for now' : ''}
      </p>

      {!shared && account && (
        <>
          <div className="goal-actions" role="group" aria-label={`${goal.name} actions`}>
            <button type="button" onClick={() => open('add')} aria-pressed={mode === 'add'} disabled={tx.busy}>Add money</button>
            <button type="button" onClick={() => open('withdraw')} aria-pressed={mode === 'withdraw'} disabled={tx.busy || goal.shares === 0n}>Take out</button>
            <button type="button" onClick={() => open('pay')} aria-pressed={mode === 'pay'} disabled={tx.busy || goal.shares === 0n}>Pay from goal</button>
            <button type="button" onClick={copyShareLink} disabled={tx.busy}>Copy share link</button>
            {goal.shares === 0n && (
              <button type="button" onClick={() => open('remove')} aria-pressed={mode === 'remove'} disabled={tx.busy}>Remove goal</button>
            )}
          </div>
          {goal.shares === 0n && !mode && (
            <p className="muted">Add money to this goal before you take money out or pay someone from it.</p>
          )}
          {mode && (
            <div className="goal-tray">
              {mode === 'pay' && (
                <label>
                  Pay to address
                  <input value={payee} placeholder="0x..." spellCheck={false} onChange={(event) => setPayee(event.target.value)} disabled={tx.busy} />
                </label>
              )}
              {mode === 'withdraw' && (
                <label className="check">
                  <input type="checkbox" checked={everything} onChange={(event) => setEverything(event.target.checked)} disabled={tx.busy} />
                  Take out everything
                </label>
              )}
              {mode !== 'remove' && !(mode === 'withdraw' && everything) && (
                <label>
                  Amount ({asset})
                  <input value={amount} inputMode="decimal" placeholder="0.00" onChange={(event) => setAmount(event.target.value)} disabled={tx.busy} />
                </label>
              )}
              {mode === 'remove' && <p className="muted">The goal is empty. Removing it only deletes its record in GoalBook.</p>}
              {tx.error && <p className="soft-error" role="alert">{tx.error}</p>}
              {reviewed && tx.quote && (tx.stage === 'sending' ? <SendingNote hash={tx.hash} /> : <ReviewNote quote={tx.quote} />)}
              {reviewed ? (
                <button type="button" className="primary" onClick={confirm} disabled={tx.busy}>
                  {tx.stage === 'sending' ? 'Confirming...' : mode === 'pay' ? 'Confirm payment' : 'Confirm'}
                </button>
              ) : (
                <button type="button" className="primary" onClick={review} disabled={tx.busy}>
                  {tx.stage === 'reviewing' ? 'Checking Arc...' : mode === 'pay' ? 'Review payment' : 'Review'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
}
