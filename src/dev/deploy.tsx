import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createWalletClient, custom, formatUnits } from 'viem'
import type { Address, Hash, Hex } from 'viem'
import { publicClient } from '../lib/chain'
import { GOAL_BOOK_RUNTIME_CODE } from '../lib/goalBookCode'
import { arcMainnet } from '../lib/networks'
import { connectToChain, injectedWallet } from '../lib/wallet'
import { deployGoalBook } from './deployGoalBook'
import '../index.css'

const artifacts = import.meta.glob<Hex>('/artifacts/contracts/GoalBook.sol/GoalBook.json', {
  eager: true,
  import: 'bytecode',
})
const bytecode = Object.values(artifacts)[0]
const local = ['127.0.0.1', 'localhost'].includes(window.location.hostname)

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function DeployPage() {
  const [account, setAccount] = useState<Address | null>(null)
  const [balance, setBalance] = useState<bigint | null>(null)
  const [hash, setHash] = useState<Hash | null>(null)
  const [address, setAddress] = useState<Address | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (!local) return <main style={{ padding: 40 }}>This page only runs on localhost.</main>

  async function connect() {
    setError('')
    try {
      const next = await connectToChain(arcMainnet)
      setAccount(next)
      setBalance(await publicClient.getBalance({ address: next }))
    } catch (cause) {
      setError(message(cause))
    }
  }

  async function deploy() {
    if (!account || !bytecode) return
    setBusy(true)
    setError('')
    try {
      const wallet = createWalletClient({ chain: arcMainnet, transport: custom(injectedWallet()) })
      const result = await deployGoalBook({ client: publicClient, wallet, account, bytecode, runtime: GOAL_BOOK_RUNTIME_CODE, onSent: setHash })
      setAddress(result.address)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 640, margin: '48px auto', padding: '0 24px', display: 'grid', gap: 16 }}>
      <h1 style={{ fontFamily: 'var(--display)', fontWeight: 400 }}>Deploy GoalBook to Arc mainnet</h1>
      <p>Local helper. Your wallet signs one deployment transaction. The page then checks that the code on Arc matches the tested build.</p>
      {!bytecode && <p role="alert">Run npm test first so Hardhat compiles GoalBook.</p>}
      <button type="button" onClick={connect} disabled={busy}>{account ? `Connected ${account}` : 'Connect wallet'}</button>
      {balance !== null && <p>Balance: {formatUnits(balance, 18)} USDC</p>}
      <button type="button" onClick={deploy} disabled={!account || !bytecode || busy || address !== null}>
        {busy ? 'Deploying...' : 'Deploy GoalBook'}
      </button>
      {hash && (
        <p>
          Transaction: <a href={`${arcMainnet.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">{hash}</a>
        </p>
      )}
      {address && <p role="status">GoalBook deployed and verified at <strong>{address}</strong></p>}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DeployPage />
  </StrictMode>,
)
