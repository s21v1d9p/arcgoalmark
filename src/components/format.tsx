import { formatUnits } from 'viem'
import type { Hash } from 'viem'
import { arcMainnet } from '../lib/networks'
import type { Quote } from '../lib/chain'

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

export function percent(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

export function explorerTx(hash: Hash): string {
  return `${arcMainnet.blockExplorers.default.url}/tx/${hash}`
}

export function ReviewNote({ quote }: { quote: Quote }) {
  return (
    <p className="review-note">
      One Arc transaction. Network fee up to {formatUnits(quote.maxNetworkFee, 18)} USDC, paid from your wallet.
    </p>
  )
}

export function SendingNote({ hash }: { hash: Hash | null }) {
  if (!hash) return <p className="review-note">Approve the transaction in your wallet.</p>
  return (
    <p className="review-note">
      Sent. Waiting for Arc to confirm.{' '}
      <a href={explorerTx(hash)} target="_blank" rel="noreferrer">View on Arc Explorer</a>
    </p>
  )
}
