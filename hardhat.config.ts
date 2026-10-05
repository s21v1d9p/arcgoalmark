import hardhatNodeTestRunner from '@nomicfoundation/hardhat-node-test-runner'
import hardhatViem from '@nomicfoundation/hardhat-viem'
import { defineConfig } from 'hardhat/config'

export default defineConfig({
  plugins: [hardhatNodeTestRunner, hardhatViem],
  solidity: {
    version: '0.8.28',
    settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 200 } },
  },
})
