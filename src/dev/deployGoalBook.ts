import { getAddress } from 'viem'
import type { Address, Hash, Hex, PublicClient, WalletClient } from 'viem'
import { arcFeeCaps } from '../lib/fees'
import { arcMainnet } from '../lib/networks'

type Deploy = {
  client: PublicClient
  wallet: WalletClient
  account: Address
  bytecode: Hex
  runtime: Hex
  onSent: (hash: Hash) => void
}

export async function deployGoalBook({ client, wallet, account, bytecode, runtime, onSent }: Deploy) {
  if ((await client.getChainId()) !== arcMainnet.id) throw new Error('RPC is not connected to Arc mainnet')
  const gas = ((await client.estimateGas({ account, data: bytecode })) * 12n) / 10n + 1n
  const { maxFeePerGas, maxPriorityFeePerGas } = arcFeeCaps(await client.estimateFeesPerGas({ chain: arcMainnet, type: 'eip1559' }))
  if ((await client.getBalance({ address: account })) < gas * maxFeePerGas) {
    throw new Error('Not enough USDC for gas')
  }
  const hash = await wallet.sendTransaction({
    account,
    chain: arcMainnet,
    data: bytecode,
    gas,
    maxFeePerGas,
    maxPriorityFeePerGas,
  })
  onSent(hash)
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 })
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error('Deployment failed')
  const code = await client.getCode({ address: receipt.contractAddress })
  if (code?.toLowerCase() !== runtime.toLowerCase()) {
    throw new Error('Deployed code does not match the tested GoalBook build')
  }
  return { hash, address: getAddress(receipt.contractAddress) }
}
