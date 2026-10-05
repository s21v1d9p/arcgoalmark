import { formatUnits, parseUnits } from 'viem'

// Arc's USDC token interface and EURC both use 6 decimals.
const DECIMALS = 6

export function parseAmount(text: string): bigint {
  const value = text.trim().replaceAll(',', '')
  if (!value) throw new Error('Enter an amount')
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error('Enter a number like 25 or 12.50')
  const [, fraction = ''] = value.split('.')
  if (fraction.length > DECIMALS) throw new Error(`Use at most ${DECIMALS} decimal places`)
  const units = parseUnits(value, DECIMALS)
  if (units === 0n) throw new Error('Enter an amount more than zero')
  return units
}

export function formatAmount(units: bigint): string {
  const [whole, fraction = ''] = formatUnits(units, DECIMALS).split('.')
  const grouped = BigInt(whole).toLocaleString('en-US')
  return `${grouped}.${fraction.padEnd(2, '0')}`
}

export function deadlineFromDate(date: string): bigint {
  if (!date) return 0n
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const time = match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59) : Number.NaN
  if (Number.isNaN(time)) throw new Error('Enter a valid date')
  return BigInt(time / 1000)
}
