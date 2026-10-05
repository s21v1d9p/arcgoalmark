import { useState } from 'react'
import type { Address } from 'viem'
import { deadlineFromDate, parseAmount } from '../lib/amounts'
import { newGoalCalls } from '../lib/goals'
import type { Vault } from '../lib/vaults'
import { percent, ReviewNote, SendingNote } from './format'
import { useTransaction } from './useTransaction'
import type { Plan } from './useTransaction'

type Props = {
  account: Address
  book: Address
  vaults: Vault[]
  usedVaults: Set<string>
  onCreated: (message: string) => void
}

function field(label: string, read: () => bigint): bigint {
  try {
    return read()
  } catch (cause) {
    throw new Error(`${label}: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

export function NewGoal({ account, book, vaults, usedVaults, onCreated }: Props) {
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [date, setDate] = useState('')
  const [vaultAddress, setVaultAddress] = useState('')
  const [deposit, setDeposit] = useState('')
  const [reviewedDraft, setReviewedDraft] = useState('')
  const tx = useTransaction(account)
  const choices = vaults.filter((vault) => !usedVaults.has(vault.address.toLowerCase()))
  const vault = choices.find((choice) => choice.address === vaultAddress) ?? null
  const draft = JSON.stringify([name, target, date, vaultAddress, deposit])
  const reviewed = tx.quote !== null && reviewedDraft === draft

  function plan(): Plan {
    const label = name.trim()
    if (!label) throw new Error('Give the goal a name')
    if (new TextEncoder().encode(label).length > 64) throw new Error('Keep the name to 64 characters or fewer')
    const targetUnits = field('Target', () => parseAmount(target))
    const deadline = deadlineFromDate(date)
    if (!vault) throw new Error('Choose a vault for this goal')
    const amount = deposit.trim() ? field('First deposit', () => parseAmount(deposit)) : 0n
    const calls = newGoalCalls({
      book,
      vault: vault.address,
      token: vault.assetAddress,
      owner: account,
      name: label,
      target: targetUnits,
      deadline,
      amount,
    })
    return amount > 0n ? { calls, vault, spend: { token: vault.assetAddress, symbol: vault.asset, amount } } : { calls, vault }
  }

  async function review() {
    if (await tx.review(plan)) setReviewedDraft(draft)
  }

  async function create() {
    const label = name.trim()
    const funded = deposit.trim() !== ''
    const done = await tx.confirm(
      (events) =>
        events.some((event) => event.eventName === 'GoalSet' && event.vault === vault?.address) &&
        (!funded || events.some((event) => event.eventName === 'DepositRecorded' && event.vault === vault?.address)),
    )
    if (!done) return
    setName('')
    setTarget('')
    setDate('')
    setVaultAddress('')
    setDeposit('')
    onCreated(`Goal "${label}" saved on Arc.`)
  }

  return (
    <section className="new-goal" aria-labelledby="new-goal-title">
      <div className="card-tab">New</div>
      <h2 id="new-goal-title">Start a goal</h2>
      <div className="form-grid">
        <label>
          Goal name
          <input value={name} maxLength={64} placeholder="Rent buffer" onChange={(event) => setName(event.target.value)} disabled={tx.busy} />
        </label>
        <label>
          Target amount
          <input value={target} inputMode="decimal" placeholder="500" onChange={(event) => setTarget(event.target.value)} disabled={tx.busy} />
        </label>
        <label>
          Target date (optional)
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={tx.busy} />
        </label>
        <label>
          First deposit (optional)
          <input value={deposit} inputMode="decimal" placeholder="25" onChange={(event) => setDeposit(event.target.value)} disabled={tx.busy} />
        </label>
      </div>

      <fieldset className="vault-picker" disabled={tx.busy}>
        <legend>Where this goal earns</legend>
        {choices.length === 0 && <p className="muted">No open vaults left. Each goal uses its own vault.</p>}
        {choices.map((choice) => (
          <label key={choice.address} className={choice.address === vaultAddress ? 'vault-choice selected' : 'vault-choice'}>
            <input
              type="radio"
              name="vault"
              value={choice.address}
              checked={choice.address === vaultAddress}
              onChange={() => setVaultAddress(choice.address)}
            />
            <span className="choice-name">{choice.name}</span>
            <span className="choice-meta">
              {choice.asset} · {percent(choice.apy)} now · {choice.curator ?? 'curator not listed'}
              {choice.status === 'low_liquidity' ? ' · low liquidity' : ''}
            </span>
          </label>
        ))}
      </fieldset>

      {tx.error && <p className="soft-error" role="alert">{tx.error}</p>}
      {reviewed && tx.quote && (tx.stage === 'sending' ? <SendingNote hash={tx.hash} /> : <ReviewNote quote={tx.quote} />)}
      <div className="form-actions">
        {reviewed ? (
          <button type="button" className="primary" onClick={create} disabled={tx.busy}>
            {tx.stage === 'sending' ? 'Creating...' : 'Create goal'}
          </button>
        ) : (
          <button type="button" className="primary" onClick={review} disabled={tx.busy}>
            {tx.stage === 'reviewing' ? 'Checking Arc...' : 'Review goal'}
          </button>
        )}
        <span className="muted">Creating the goal and the first deposit happen in the same transaction.</span>
      </div>
    </section>
  )
}
