import { useState } from 'react'
import type { Address, Hash } from 'viem'
import { checkVault, configuredBook, goalEvents, prepareTransaction, sendTransaction } from '../lib/chain'
import type { GoalEvent, Quote, Spend } from '../lib/chain'
import type { Call } from '../lib/goals'
import type { Vault } from '../lib/vaults'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type Plan = { calls: Call[]; spend?: Spend; vault?: Vault }

// Review, then send one Arc transaction and confirm GoalBook recorded what was asked for.
export function useTransaction(account: Address | null) {
  const [quote, setQuote] = useState<Quote | null>(null)
  const [stage, setStage] = useState<'idle' | 'reviewing' | 'sending'>('idle')
  const [error, setError] = useState('')
  const [hash, setHash] = useState<Hash | null>(null)

  async function review(plan: () => Plan): Promise<boolean> {
    if (!account) return false
    setError('')
    setQuote(null)
    setStage('reviewing')
    try {
      const { calls, spend, vault } = plan()
      if (vault) await checkVault(vault)
      setQuote(await prepareTransaction(spend ? { account, calls, spend } : { account, calls }))
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setStage('idle')
    }
  }

  async function confirm(expected: (events: GoalEvent[]) => boolean): Promise<boolean> {
    if (!quote || !account) return false
    setError('')
    setStage('sending')
    try {
      const receipt = await sendTransaction(quote, setHash)
      if (!expected(goalEvents(receipt, configuredBook(), account))) {
        throw new Error('The transaction confirmed, but GoalBook did not record the change')
      }
      setQuote(null)
      setHash(null)
      return true
    } catch (cause) {
      setError(errorMessage(cause))
      return false
    } finally {
      setStage('idle')
    }
  }

  function reset() {
    setQuote(null)
    setError('')
    setHash(null)
  }

  return { quote, stage, error, hash, review, confirm, reset, busy: stage !== 'idle' }
}
