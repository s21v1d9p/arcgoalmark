import { describe, expect, it } from 'vitest'
import { ARC_EURC, ARC_USDC, loadVaults, rankVaults, toVault } from './vaults'
import type { EarnVaultRecord, Vault } from './vaults'

// Shape copied from a live Earn Kit exploreVaults({ chain: 'Arc' }) result on 2026-10-05.
const steakhouse: EarnVaultRecord = {
  vaultAddress: '0xbeef0016cb2fd5c352ea7ca08a9f54739dfa7298',
  chain: 'Arc',
  name: 'Steakhouse Prime USDC',
  protocol: 'MORPHO',
  asset: 'USDC',
  assetAddress: '0x3600000000000000000000000000000000000000',
  currentApy: 0.0122,
  apyProfile: { d30: 0.0008 },
  manager: { name: 'Steakhouse Financial' },
  totalDeposits: '2585079.81',
  liquidity: '1.00',
  status: 'active',
  circleGuarded: false,
  liquidityProfile: { status: 'low_liquidity', available: '265.63' },
  riskSignals: { circleSentinel: true },
  warnings: [{ type: 'low_liquidity', level: 'YELLOW' }],
  collateral: [{ asset: 'cirBTC' }, { asset: 'Idle' }, { asset: 'cirBTC' }],
}

function vault(overrides: Partial<Vault>): Vault {
  return {
    address: '0x1111111111111111111111111111111111111111',
    name: 'Vault',
    asset: 'USDC',
    assetAddress: ARC_USDC,
    curator: null,
    apy: 0.01,
    apy30d: null,
    totalDeposits: 10_000,
    liquidity: 10_000,
    status: 'active',
    circleSentinel: false,
    warnings: [],
    collateral: [],
    ...overrides,
  }
}

describe('toVault', () => {
  it('keeps the details a saver needs to judge a vault', () => {
    expect(toVault(steakhouse)).toEqual({
      address: '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298',
      name: 'Steakhouse Prime USDC',
      asset: 'USDC',
      assetAddress: ARC_USDC,
      curator: 'Steakhouse Financial',
      apy: 0.0122,
      apy30d: 0.0008,
      totalDeposits: 2585079.81,
      liquidity: 265.63,
      status: 'low_liquidity',
      circleSentinel: true,
      warnings: ['low_liquidity'],
      collateral: ['cirBTC'],
    })
    expect(toVault({ ...steakhouse, asset: 'EURC', assetAddress: ARC_EURC.toLowerCase() })?.assetAddress).toBe(ARC_EURC)
  })

  it('drops vaults with unknown tokens, other chains, test-sized deposits or odd states', () => {
    expect(toVault({ ...steakhouse, assetAddress: '0x0000000000000000000000000000000000000001' })).toBeNull()
    expect(toVault({ ...steakhouse, asset: 'cirBTC' })).toBeNull()
    expect(toVault({ ...steakhouse, chain: 'Arc_Testnet' })).toBeNull()
    expect(toVault({ ...steakhouse, totalDeposits: '999.99' })).toBeNull()
    expect(toVault({ ...steakhouse, liquidityProfile: { status: 'paused', available: '1' } })).toBeNull()
    const legacy = { ...steakhouse, liquidityProfile: undefined, riskSignals: undefined, status: 'active', liquidity: '9', circleGuarded: true }
    expect(toVault(legacy)).toMatchObject({ status: 'active', liquidity: 9, circleSentinel: true })
    expect(toVault({ ...steakhouse, name: '  ' })).toBeNull()
    expect(toVault({ ...steakhouse, vaultAddress: 'not-an-address' })).toBeNull()
  })
})

describe('rankVaults and loadVaults', () => {
  it('lists active vaults first, then the largest', () => {
    const ranked = rankVaults([
      vault({ name: 'Small active', totalDeposits: 5_000 }),
      vault({ name: 'Huge but low liquidity', totalDeposits: 9_000_000, status: 'low_liquidity' }),
      vault({ name: 'Big active', totalDeposits: 80_000 }),
    ])
    expect(ranked.map((item) => item.name)).toEqual(['Big active', 'Small active', 'Huge but low liquidity'])
  })

  it('loads vaults from Earn Kit and keeps only usable ones', async () => {
    const vaults = await loadVaults(async () => [steakhouse, { ...steakhouse, chain: 'Arc_Testnet' }])
    expect(vaults.map((item) => item.name)).toEqual(['Steakhouse Prime USDC'])
  })
})
