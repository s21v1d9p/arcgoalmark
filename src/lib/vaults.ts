import { getAddress, isAddress } from 'viem'
import type { Address } from 'viem'

export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const
export const ARC_EURC = '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1' as const
const TOKENS = { USDC: ARC_USDC, EURC: ARC_EURC } as const

// Hides test and near-empty vaults from the list.
export const MIN_VAULT_DEPOSITS = 1_000

export type Asset = keyof typeof TOKENS

export type Vault = {
  address: Address
  name: string
  asset: Asset
  assetAddress: Address
  curator: string | null
  apy: number
  apy30d: number | null
  totalDeposits: number
  liquidity: number
  status: 'active' | 'low_liquidity'
  circleSentinel: boolean
  warnings: string[]
  collateral: string[]
}

export type EarnVaultRecord = {
  vaultAddress?: string
  address?: string
  chain?: string
  name: string
  protocol?: string
  asset: string
  assetAddress: string
  currentApy: number
  apyProfile?: { d30?: number | null } | null
  manager?: { name?: string | null } | null
  totalDeposits: string
  liquidity?: string
  status?: string
  circleGuarded?: boolean
  liquidityProfile?: { status?: string; available?: string } | null
  riskSignals?: { circleSentinel?: boolean } | null
  warnings?: readonly { type: string; level?: string }[]
  collateral?: readonly { asset: string }[]
}

export function toVault(record: EarnVaultRecord): Vault | null {
  const asset = record.asset === 'USDC' || record.asset === 'EURC' ? record.asset : null
  const address = record.vaultAddress ?? record.address
  if (!asset || !address || !isAddress(address) || record.chain !== 'Arc') return null
  // Approvals only ever go to vaults that hold Arc's own USDC or EURC.
  if (record.assetAddress.toLowerCase() !== TOKENS[asset].toLowerCase()) return null
  // Earn Kit moved these fields into liquidityProfile and riskSignals; older responses still use the flat ones.
  const status = record.liquidityProfile?.status ?? record.status
  if (status !== 'active' && status !== 'low_liquidity') return null
  const name = record.name.trim()
  const totalDeposits = Number(record.totalDeposits)
  if (!name || !(totalDeposits >= MIN_VAULT_DEPOSITS)) return null

  return {
    address: getAddress(address),
    name,
    asset,
    assetAddress: TOKENS[asset],
    curator: record.manager?.name ?? null,
    apy: record.currentApy,
    apy30d: record.apyProfile?.d30 ?? null,
    totalDeposits,
    liquidity: Number(record.liquidityProfile?.available ?? record.liquidity ?? 0),
    status,
    circleSentinel: (record.riskSignals?.circleSentinel ?? record.circleGuarded) === true,
    warnings: (record.warnings ?? []).map((warning) => warning.type),
    collateral: [...new Set((record.collateral ?? []).map((item) => item.asset).filter((item) => item && item !== 'Idle'))],
  }
}

export function rankVaults(vaults: Vault[]): Vault[] {
  return [...vaults].sort(
    (a, b) => Number(a.status !== 'active') - Number(b.status !== 'active') || b.totalDeposits - a.totalDeposits,
  )
}

async function exploreArcVaults(): Promise<EarnVaultRecord[]> {
  const { EarnKit } = await import('@circle-fin/earn-kit')
  const records: EarnVaultRecord[] = []
  for await (const vault of new EarnKit().exploreVaultsIterator({ chain: 'Arc' })) records.push(vault)
  return records
}

export async function loadVaults(explore: () => Promise<EarnVaultRecord[]> = exploreArcVaults): Promise<Vault[]> {
  const records = await explore()
  return rankVaults(records.map(toVault).filter((vault): vault is Vault => vault !== null))
}
