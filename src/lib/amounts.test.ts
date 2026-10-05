import { describe, expect, it } from 'vitest'
import { deadlineFromDate, formatAmount, parseAmount } from './amounts'

describe('parseAmount', () => {
  it('reads token amounts with up to 6 decimals', () => {
    expect(parseAmount('1')).toBe(1_000_000n)
    expect(parseAmount(' 0.5 ')).toBe(500_000n)
    expect(parseAmount('1,250.75')).toBe(1_250_750_000n)
    expect(parseAmount('0.000001')).toBe(1n)
  })

  it('rejects empty, zero, negative and over-precise amounts', () => {
    expect(() => parseAmount('')).toThrow('Enter an amount')
    expect(() => parseAmount('0')).toThrow('more than zero')
    expect(() => parseAmount('-1')).toThrow('Enter a number')
    expect(() => parseAmount('1e3')).toThrow('Enter a number')
    expect(() => parseAmount('0.0000001')).toThrow('at most 6 decimal places')
  })
})

describe('formatAmount', () => {
  it('shows two decimals at least and keeps real precision', () => {
    expect(formatAmount(1_000_000n)).toBe('1.00')
    expect(formatAmount(1_250_750_000n)).toBe('1,250.75')
    expect(formatAmount(1_234_567n)).toBe('1.234567')
    expect(formatAmount(0n)).toBe('0.00')
  })
})

describe('deadlineFromDate', () => {
  it('turns a date into the end of that day in UTC, or no deadline', () => {
    expect(deadlineFromDate('2026-12-01')).toBe(BigInt(Date.UTC(2026, 11, 1, 23, 59, 59) / 1000))
    expect(deadlineFromDate('')).toBe(0n)
    expect(() => deadlineFromDate('not-a-date')).toThrow('valid date')
  })
})
