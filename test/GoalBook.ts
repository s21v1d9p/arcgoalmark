import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { network } from 'hardhat'
import { decodeEventLog, getAddress, parseUnits, zeroAddress } from 'viem'

const { viem } = await network.create()
const usdc = (value: string) => parseUnits(value, 6)

type Goal = { vault: string; deadline: bigint; createdAt: bigint; target: bigint; deposited: bigint; name: string }

describe('GoalBook', () => {
  async function setup() {
    const [saver, other] = await viem.getWalletClients()
    const publicClient = await viem.getPublicClient()
    const book = await viem.deployContract('GoalBook')
    const rent = await viem.deployContract('StubVault')
    const trip = await viem.deployContract('StubVault')
    const asOther = await viem.getContractAt('GoalBook', book.address, { client: { wallet: other } })
    return { saver, other, publicClient, book, asOther, rent, trip }
  }

  async function revertsWith(action: Promise<unknown>, error: string) {
    await assert.rejects(action, (cause: unknown) => String(cause).includes(error))
  }

  it('stores one goal per wallet and vault, and updates it in place', async () => {
    const { saver, publicClient, book, rent } = await setup()
    const hash = await book.write.setGoal([rent.address, 'Rent buffer', usdc('500'), 1_767_225_600n])
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber })

    const [goal] = (await book.read.goalsOf([saver.account.address])) as readonly Goal[]
    assert.deepEqual(goal, {
      vault: getAddress(rent.address),
      deadline: 1_767_225_600n,
      createdAt: block.timestamp,
      target: usdc('500'),
      deposited: 0n,
      name: 'Rent buffer',
    })
    const event = decodeEventLog({ abi: book.abi, data: receipt.logs[0].data, topics: receipt.logs[0].topics })
    assert.equal(event.eventName, 'GoalSet')

    await book.write.setGoal([rent.address, 'Rent', usdc('600'), 0n])
    const goals = (await book.read.goalsOf([saver.account.address])) as readonly Goal[]
    assert.equal(goals.length, 1)
    assert.equal(goals[0].name, 'Rent')
    assert.equal(goals[0].target, usdc('600'))
    assert.equal(goals[0].deadline, 0n)
    assert.equal(goals[0].createdAt, block.timestamp)
  })

  it('records deposits and withdrawals without going below zero', async () => {
    const { saver, book, rent } = await setup()
    await book.write.setGoal([rent.address, 'Rent', usdc('500'), 0n])
    await book.write.recordDeposit([rent.address, usdc('100')])
    await book.write.recordDeposit([rent.address, usdc('25.5')])
    assert.equal(((await book.read.goalOf([saver.account.address, rent.address])) as Goal).deposited, usdc('125.5'))

    await book.write.recordWithdrawal([rent.address, usdc('25')])
    assert.equal(((await book.read.goalOf([saver.account.address, rent.address])) as Goal).deposited, usdc('100.5'))
    // Withdrawing interest on top of the principal leaves nothing recorded, never a negative amount.
    await book.write.recordWithdrawal([rent.address, usdc('101')])
    assert.equal(((await book.read.goalOf([saver.account.address, rent.address])) as Goal).deposited, 0n)
  })

  it('removes a goal and keeps the other goals intact', async () => {
    const { saver, book, rent, trip } = await setup()
    await book.write.setGoal([rent.address, 'Rent', usdc('500'), 0n])
    await book.write.setGoal([trip.address, 'Trip', usdc('300'), 0n])
    await book.write.recordDeposit([trip.address, usdc('40')])
    await book.write.removeGoal([rent.address])

    const goals = (await book.read.goalsOf([saver.account.address])) as readonly Goal[]
    assert.deepEqual(goals.map((goal) => [goal.name, goal.deposited]), [['Trip', usdc('40')]])
    await book.write.recordDeposit([trip.address, usdc('1')])
    assert.equal(((await book.read.goalOf([saver.account.address, trip.address])) as Goal).deposited, usdc('41'))
    await revertsWith(book.read.goalOf([saver.account.address, rent.address]), 'UnknownGoal')

    await book.write.setGoal([rent.address, 'Rent again', usdc('50'), 0n])
    assert.equal(((await book.read.goalsOf([saver.account.address])) as readonly Goal[]).length, 2)
  })

  it('keeps every wallet separate', async () => {
    const { saver, other, book, asOther, rent } = await setup()
    await book.write.setGoal([rent.address, 'Mine', usdc('10'), 0n])
    await revertsWith(asOther.write.recordDeposit([rent.address, usdc('1')]), 'UnknownGoal')
    await asOther.write.setGoal([rent.address, 'Theirs', usdc('20'), 0n])
    await asOther.write.recordDeposit([rent.address, usdc('5')])

    assert.equal(((await book.read.goalOf([saver.account.address, rent.address])) as Goal).deposited, 0n)
    assert.equal(((await book.read.goalOf([other.account.address, rent.address])) as Goal).name, 'Theirs')
  })

  it('rejects invalid goals and unknown vaults', async () => {
    const { saver, book, rent } = await setup()
    await revertsWith(book.write.setGoal([zeroAddress, 'Rent', usdc('1'), 0n]), 'InvalidVault')
    await revertsWith(book.write.setGoal([saver.account.address, 'Rent', usdc('1'), 0n]), 'InvalidVault')
    await revertsWith(book.write.setGoal([rent.address, '', usdc('1'), 0n]), 'InvalidName')
    await revertsWith(book.write.setGoal([rent.address, 'x'.repeat(65), usdc('1'), 0n]), 'InvalidName')
    await book.write.setGoal([rent.address, 'x'.repeat(64), usdc('1'), 0n])
    await revertsWith(book.write.setGoal([rent.address, 'Rent', 0n, 0n]), 'InvalidTarget')
    await revertsWith(book.write.removeGoal([saver.account.address]), 'UnknownGoal')
    await revertsWith(book.write.recordWithdrawal([saver.account.address, 1n]), 'UnknownGoal')
  })

  it('caps the number of goals per wallet', async () => {
    const { saver, book } = await setup()
    const max = (await book.read.MAX_GOALS()) as bigint
    for (let index = 0n; index < max; index += 1n) {
      const vault = await viem.deployContract('StubVault')
      await book.write.setGoal([vault.address, `Goal ${index}`, usdc('1'), 0n])
    }
    const extra = await viem.deployContract('StubVault')
    await revertsWith(book.write.setGoal([extra.address, 'One too many', usdc('1'), 0n]), 'TooManyGoals')
    assert.equal(((await book.read.goalsOf([saver.account.address])) as readonly Goal[]).length, Number(max))
  })
})
