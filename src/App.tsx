import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { getAddress, isAddress } from 'viem'
import type { Address } from 'viem'
import { GoalCard } from './components/GoalCard'
import { NewGoal } from './components/NewGoal'
import { SharedGoal } from './components/SharedGoal'
import { VaultTable } from './components/VaultTable'
import { shortAddress } from './components/format'
import { errorMessage } from './components/useTransaction'
import { configuredBook, connectWallet, goalReader } from './lib/chain'
import { loadGoals } from './lib/goals'
import type { GoalView } from './lib/goals'
import { loadVaults } from './lib/vaults'
import type { Vault } from './lib/vaults'
import './App.css'

function sharedLink(): { owner: Address; vault: Address } | null {
  const params = new URLSearchParams(window.location.search)
  const owner = params.get('owner')
  const vault = params.get('vault')
  return owner && vault && isAddress(owner) && isAddress(vault) ? { owner: getAddress(owner), vault: getAddress(vault) } : null
}

function bookAddress(): { address: Address | null; error: string } {
  try {
    return { address: configuredBook(), error: '' }
  } catch (cause) {
    return { address: null, error: errorMessage(cause) }
  }
}

function App() {
  const shared = useMemo(sharedLink, [])
  const book = useMemo(bookAddress, [])
  const [vaults, setVaults] = useState<Vault[] | null>(null)
  const [vaultsError, setVaultsError] = useState('')
  const [account, setAccount] = useState<Address | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [goals, setGoals] = useState<GoalView[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    loadVaults()
      .then((list) => active && setVaults(list))
      .catch((cause: unknown) => active && setVaultsError(`Could not load vaults from Circle's Earn Kit: ${errorMessage(cause)}`))
    return () => {
      active = false
    }
  }, [])

  async function refreshGoals(owner: Address) {
    if (!book.address) return
    try {
      setGoals(await loadGoals(goalReader, book.address, owner))
    } catch (cause) {
      setError(`Could not read your goals from Arc: ${errorMessage(cause)}`)
    }
  }

  async function connect() {
    setError('')
    setConnecting(true)
    try {
      const owner = await connectWallet()
      setAccount(owner)
      await refreshGoals(owner)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setConnecting(false)
    }
  }

  async function changed(message: string) {
    setNotice(message)
    if (account) await refreshGoals(account)
  }

  const vaultFor = (address: Address) => vaults?.find((vault) => vault.address.toLowerCase() === address.toLowerCase())
  const usedVaults = new Set((goals ?? []).map((goal) => goal.vault.toLowerCase()))

  return (
    <div className="page">
      <header className="masthead">
        <a className="brand" href={window.location.pathname} aria-label="Arc Goalmark home">
          <span className="brand-ribbon" aria-hidden="true" />
          arc <em>goalmark</em>
        </a>
        <nav aria-label="Main navigation">
          <a href="#vaults">Vaults</a>
          <a href="#how">How it works</a>
        </nav>
        {!shared && (
          <button type="button" className="wallet" onClick={connect} disabled={connecting}>
            {account ? shortAddress(account) : connecting ? 'Connecting...' : 'Connect wallet'}
          </button>
        )}
      </header>

      <main>
        {shared ? (
          <SharedGoal owner={shared.owner} vault={shared.vault} vaults={vaults} />
        ) : (
          <>
            <section className="hero" aria-labelledby="hero-title">
              <div className="hero-copy">
                <span className="tab-label">USDC and EURC savings on Arc mainnet</span>
                <h1 id="hero-title">Set money aside <em>for what it's for.</em></h1>
                <p>
                  Name a goal, pick the vault it earns in, and watch it fill. When the day comes, take it out or pay
                  someone straight from the goal. Every step is one Arc transaction.
                </p>
              </div>
              <div className="hero-ribbons" aria-hidden="true">
                <div className="hero-ribbon" style={{ '--fill': '78%' } as CSSProperties}><span>Rent buffer</span></div>
                <div className="hero-ribbon" style={{ '--fill': '41%' } as CSSProperties}><span>Trip in EURC</span></div>
                <div className="hero-ribbon" style={{ '--fill': '92%' } as CSSProperties}><span>New laptop</span></div>
              </div>
            </section>

            {error && <p className="soft-error banner" role="alert">{error}</p>}
            {notice && <p className="notice" role="status">{notice}</p>}
            {book.error && <p className="soft-error banner">{book.error}. Deploy GoalBook and set VITE_GOAL_BOOK_ADDRESS.</p>}

            <section className="goals" aria-labelledby="goals-title">
              <div className="section-head">
                <span className="tab-label">Your goals</span>
                <h2 id="goals-title">{account ? 'Your goals' : 'Connect a wallet to see your goals'}</h2>
              </div>
              {account && goals?.length === 0 && <p className="muted">No goals yet. Start one below.</p>}
              <div className="goal-grid">
                {account && book.address && goals?.map((goal) => (
                  <GoalCard key={goal.vault} goal={goal} vault={vaultFor(goal.vault)} account={account} book={book.address as Address} onChanged={changed} />
                ))}
              </div>
              {account && book.address && vaults && (
                <NewGoal account={account} book={book.address} vaults={vaults} usedVaults={usedVaults} onCreated={changed} />
              )}
            </section>

            <VaultTable vaults={vaults} error={vaultsError} />

            <section className="risk" aria-labelledby="risk-title">
              <h2 id="risk-title">Before you save</h2>
              <p>
                Arc Goalmark never holds your money. Deposits go into Morpho vaults on Arc that outside curators run, and
                the vault shares stay in your wallet. Rates change, a vault can lose money if its borrowers fail, and a
                vault with low liquidity may not let you withdraw right away. Vault details come from Circle's Earn Kit.
              </p>
            </section>
          </>
        )}

        <section id="how" className="how" aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ol>
            <li><strong>Name a goal.</strong> The name, target and date are saved in GoalBook, a small contract on Arc that holds no funds.</li>
            <li><strong>Deposit.</strong> Approving the token, depositing into the vault and updating the goal happen in one transaction, using Arc's Multicall3From.</li>
            <li><strong>Use it.</strong> Take money out, or pay another address straight from the vault. Arc settles it in under a second.</li>
          </ol>
        </section>
      </main>

      <footer className="colophon">
        <span>arc <em>goalmark</em></span>
        <span>Savings goals on Arc mainnet</span>
        <a href="https://github.com/s21v1d9p/arcgoalmark" target="_blank" rel="noreferrer">GitHub</a>
        <a href="https://explorer.arc.io" target="_blank" rel="noreferrer">Arc Explorer</a>
      </footer>
    </div>
  )
}

export default App
