import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { configuredBook, goalReader } from '../lib/chain'
import { loadGoal } from '../lib/goals'
import type { GoalView } from '../lib/goals'
import type { Vault } from '../lib/vaults'
import { GoalCard } from './GoalCard'
import { shortAddress } from './format'
import { errorMessage } from './useTransaction'

export function SharedGoal({ owner, vault, vaults }: { owner: Address; vault: Address; vaults: Vault[] | null }) {
  const [goal, setGoal] = useState<GoalView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    loadGoal(goalReader, configuredBook(), owner, vault)
      .then((result) => {
        if (!active) return
        setGoal(result)
        setState(result ? 'ready' : 'missing')
      })
      .catch((cause: unknown) => {
        if (active) setError(`Could not read this goal from Arc: ${errorMessage(cause)}`)
      })
    return () => {
      active = false
    }
  }, [owner, vault])

  return (
    <section className="shared" aria-label="Shared goal">
      <p className="tab-label">Read from Arc mainnet for {shortAddress(owner)}</p>
      {error && <p className="soft-error" role="alert">{error}</p>}
      {!error && state === 'loading' && <p className="muted">Reading the goal from Arc...</p>}
      {state === 'missing' && <p className="soft-error" role="alert">This wallet has no goal for that vault.</p>}
      {goal && (
        <GoalCard
          goal={goal}
          vault={vaults?.find((item) => item.address.toLowerCase() === vault.toLowerCase())}
          account={null}
          book={configuredBook()}
          shared
        />
      )}
      <p className="muted">
        The saved amount comes from the vault on Arc. Interest is the saved amount minus what was deposited through Arc Goalmark.
      </p>
      <a className="text-link" href={window.location.pathname}>Start your own goals</a>
    </section>
  )
}
