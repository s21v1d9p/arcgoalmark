# Arc Goalmark

[![CI](https://github.com/s21v1d9p/arcgoalmark/actions/workflows/ci.yml/badge.svg)](https://github.com/s21v1d9p/arcgoalmark/actions/workflows/ci.yml)

Arc Goalmark is a small web app for saving toward goals in USDC or EURC on Arc. You name a goal, choose the vault it earns in, and add money. When you need it, you take it out or pay someone straight from the goal.

I built it for people and small teams who set money aside for something specific, like a rent buffer or a trip, and want it to earn a little while it waits.

- Live app: https://arcgoalmark.vercel.app

## Deployments

| Network | GoalBook | Deployment |
| --- | --- | --- |
| Arc mainnet (5042) | [0x9c93...E5F7](https://explorer.arc.io/address/0x9c93345f84f263F44704d5cB92eaEE35927CE5F7) | [0x899f...2502](https://explorer.arc.io/tx/0x899f1200633d0396fb4fd4128a9702835ca78f5512eb040b8db8ddd181a22502) |

The source is verified on Arc Explorer, and the deployed runtime bytecode is identical to the tested build. Deploying it cost about 0.02 USDC.

## Why Arc

- USDC is Arc's gas token, so a USDC saver only needs USDC.
- Arc's `Multicall3From` keeps your wallet as the sender of each call. Approving the token, depositing into the vault and updating the goal happen in one transaction with one signature.
- Arc has deterministic finality, so a withdrawal or a payment from a goal is final in under a second.
- EURC is native on Arc, so euro savings work the same way as dollar savings.
- The vault list comes from Circle's Earn Kit, which lists Morpho vaults on Arc mainnet with their curators, rates, liquidity and Circle Sentinel coverage.

## How it works

1. `contracts/GoalBook.sol` stores each goal: the vault, a name, a target, an optional date and the amount you deposited through the app. It holds no funds and has no owner. Each wallet can have one goal per vault and up to 20 goals.
2. A deposit is one `Multicall3From` batch: approve the exact amount for the vault, deposit into the vault, and record the deposit in GoalBook. If any step fails, the whole transaction reverts. A new goal and its first deposit go in the same batch.
3. Withdrawals and payments are one batch too: withdraw from the vault straight to you or to the address you are paying, then record it in GoalBook.
4. Progress comes from the vault. Your vault shares are converted to their current value on chain, and interest is that value minus what you deposited through the app.
5. A share link (`?owner=...&vault=...`) shows one goal read-only, straight from Arc.

## Security notes

- GoalBook never holds money. Vault shares stay in your wallet, and only your wallet can change your goals.
- The app only approves the exact deposit amount, and only for vaults whose on-chain `asset()` is Arc's USDC (`0x3600...0000`) or EURC (`0xbEf5...21c1`).
- The app pins GoalBook's runtime bytecode in `src/lib/goalBookCode.ts` and refuses to use an address with different code.
- The recorded deposit amount is your own bookkeeping. If you move money in or out of the vault outside the app, the interest figure will be off. The saved amount is always read from the vault.
- Vaults are run by outside curators on Morpho. Rates change, a vault can lose money if its borrowers fail, and a vault with low liquidity may not let you withdraw right away. The app shows Earn Kit's liquidity status for every vault.
- Earn Kit is a multi-chain SDK and brings in ethers v5 and Solana packages. `npm audit` reports low and moderate advisories in those packages and none rated high. The app only uses Earn Kit to list vaults, and loads it separately from the main bundle.
- RPC calls go through a same-origin `/arc-rpc` proxy first, with `https://rpc.mainnet.arc.io` as the fallback, because privacy filter lists block third-party `arc.io` requests.
- The contract and app have not been audited.

## Running it locally

You need Node.js 22.12+ or 24+.

```bash
npm ci
npm run check
npm run dev
```

`npm run check` compiles the contract, then runs the frontend tests, the Hardhat contract tests, the linter, the TypeScript build and the production build.

## Deploying

1. Run `npm run dev` and open `http://127.0.0.1:5173/deploy.html`. This page only runs on localhost and is not part of the production build. Connect a wallet on Arc mainnet and deploy GoalBook. The page checks that the deployed code matches the tested build.
2. Set `VITE_GOAL_BOOK_ADDRESS` to the deployed address and build. `vercel.json` proxies `/arc-rpc` to Arc's RPC and sets basic security headers.

## License

MIT
