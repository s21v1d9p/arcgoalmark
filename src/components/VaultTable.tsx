import type { Vault } from '../lib/vaults'
import { percent } from './format'

function compact(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function VaultTable({ vaults, error }: { vaults: Vault[] | null; error: string }) {
  return (
    <section id="vaults" className="ledger-section" aria-labelledby="vaults-title">
      <div className="section-head">
        <span className="tab-label">Vaults</span>
        <h2 id="vaults-title">Where your savings earn</h2>
        <p>
          Morpho vaults on Arc mainnet, listed live by Circle's Earn Kit. Rates move every day. Low liquidity means a
          withdrawal can fail until borrowers repay.
        </p>
      </div>
      {error && <p className="soft-error" role="alert">{error}</p>}
      {!vaults && !error && <p className="muted">Loading vaults from Earn Kit...</p>}
      {vaults && (
        <div className="table-scroll">
          <table className="vault-table">
            <thead>
              <tr>
                <th scope="col">Vault</th>
                <th scope="col">Token</th>
                <th scope="col">APY now</th>
                <th scope="col">30-day APY</th>
                <th scope="col">Deposits</th>
                <th scope="col">Lent against</th>
                <th scope="col">Signals</th>
              </tr>
            </thead>
            <tbody>
              {vaults.map((vault) => (
                <tr key={vault.address}>
                  <td>
                    <strong>{vault.name}</strong>
                    <span className="curator">{vault.curator ?? 'Curator not listed'}</span>
                  </td>
                  <td>{vault.asset}</td>
                  <td className="figure">{percent(vault.apy)}</td>
                  <td className="figure">{vault.apy30d === null ? 'n/a' : percent(vault.apy30d)}</td>
                  <td className="figure">{compact(vault.totalDeposits)}</td>
                  <td>{vault.collateral.join(', ') || 'n/a'}</td>
                  <td>
                    <div className="chips">
                      {vault.status === 'low_liquidity'
                        ? <span className="chip chip-warn">Low liquidity</span>
                        : <span className="chip">Liquid</span>}
                      {vault.circleSentinel && <span className="chip chip-quiet">Covered by Circle Sentinel</span>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
