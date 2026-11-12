# cardsdotgg

Yield-funded card battles and a liquidity pool on NEAR testnet. Deposit test tokens, mint a deck, and stake accrued yield in 1v1 battles that resolve onchain. Principal never moves in a match. Deck yield rates and the NEAR price are read from real [Rhea](https://rhea.finance) pools on NEAR mainnet.

Every action in the app is a real wallet-signed transaction. Test tokens have no real value.

> **Status:** deployed on NEAR testnet and exercised end to end (claim, deposit, seed, challenge, accept, resolve, replay, withdraw) with two fresh accounts. Explorer: https://testnet.nearblocks.io. The contracts are unaudited prototypes.

## Live contracts (NEAR testnet)

| Contract | Account |
| --- | --- |
| game (oracle, vault, escrow, arena) | `9cc71b1795d97d7afedcf6ca6863a9134b9adb117301f79d84424d5471daf0f4` |
| tUSD | `7d06f44ba61478f74028c9d8699a23e7c131f5f3379c2a311cc0a202b4bb303e` |
| tNEAR | `0614bb856676794695de6f15e98539e9d4a3763090fb7bb194e2cc0c67b9ad30` |
| pool (tUSD/tNEAR) | `d1cf94d90fecf6894df4077d1d0b7ef7a6ce59d0dc336c68bae66136df5b0cad` |

NEAR keeps one contract per account, so the game contract lives on the owner account and the other three on implicit accounts. NEAR needs wasm built with `--cfg near` (what `cargo near build` sets); a plain `cargo build` produces wasm whose panics have no message and whose token receivers fail. Build with `RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release --workspace`.

## How it works

1. **Claim and deposit.** Claim tUSD or tNEAR once per 24 hours, then deposit at least 10 tUSD of value (tNEAR is valued at the Rhea-derived price) to mint a Guardian, Balanced or Degen deck. A deposit is one `ft_transfer_call`: no approve step.
2. **Earn.** Yield accrues to the deck's escrow in tUSD at the oracle rate, paid from a reserve the owner funded.
3. **Battle.** Challenge a named account or leave the opponent blank. Each player stakes 0.1% of their deposit from escrow. If either side is short, the match is Rank-only.
4. **Resolve and replay.** Anyone can call `resolve` once the seed block has passed. The keeper's resolver (`pnpm resolve:watch`) does it automatically within a few seconds, so players sign nothing for it, and it also closes challenges that sat open for an hour. `keeper/deploy/install-resolver.sh` installs it as a systemd user service (logs: `journalctl --user -u cardsdotgg-resolver -f`; add `sudo loginctl enable-linger $USER` to keep it running after logout). Without a running resolver the app's FIGHT button still works. The app replays the contract's own `simulate_with_log` output. The winner gets 95% of the loser's stake, 5% goes to the prize pool, and Elo updates (start 500, K=32).
5. **Withdraw.** A full withdraw retires the deck and pays principal plus remaining escrow, in tUSD or tNEAR at the oracle price.

The **pool** page is a separate tUSD/tNEAR constant-product pool (0.3% fee that stays in the reserves). Swaps are one signature: `ft_transfer_call` with `{"action":"swap","min_out":...}` and the output is paid straight to the wallet. Adding liquidity sends both tokens in one wallet approval and the pool adds the position when the second token lands, in either order. Remove and withdraw is one transaction (`remove_liquidity` then `withdraw_all`). Anything left in the pool balance after a failure can be withdrawn with `withdraw_all`.

### Wallet signatures

The app bundles where NEAR allows it: several actions to one contract share one transaction, and several transactions share one wallet approval (`signAndSendTransactions`). Claim both tokens is 1 approval, a first-time tNEAR withdraw (register + withdraw) is 1, pool swap is 1, add liquidity is 1 (two transfers), remove + withdraw is 1. Transfers that attach the 1 yoctoNEAR deposit always prompt the wallet.

## Where Rhea data is used

A one-shot keeper (`keeper/`) reads NEAR mainnet and writes `shared/rate-sources.json` and `shared/liquidity-source.json`. It runs on demand, so these are snapshots, not a live feed.

| Use | Rhea source |
| --- | --- |
| Guardian rate | Rated stable pool #4179 (USDt/USDC/USDT.e/USDC.e) |
| Balanced rate | USDC/wNEAR pool #4512 |
| Degen rate | RHEA/wNEAR pool #6458 |
| tNEAR price and pool opening depth | USDC/wNEAR pool #4512 reserves |

- **Method:** pool APY, TVL and 24h volume come from `indexer.ref.finance/proxy/pool/search`, and the keeper cross-checks the pool's tokens against `get_pool` on `v2.ref-finance.near` over RPC. The rate is Rhea's reported APY for the whole pool. It is not what any single position earned, and it ignores impermanent loss. The oracle caps rates at 50% and moves them at most 2 points per keeper run after the first.
- **No gold:** there is no gold token with a Rhea price on NEAR, so the former tGOLD asset became **tNEAR**.
- **Prices:** USDC is treated as 1 USD. The testnet pool opens at the Rhea price and total value using test tokens. It does not hold real assets, and its price moves only with its own swaps.
- **Payouts:** yield is paid in test tUSD from the reserve. Mainnet fees stay with Rhea's liquidity providers.

## Layout

| Path | Contents |
| --- | --- |
| `near/game` | Rust contract: rate oracle, deck vault, yield escrow, arena, Elo, onchain SVG, and the battle engine (a port of the Solidity engine) |
| `near/ft` | Rust NEP-141 test token with a 24h `claim`; deployed twice as tUSD and tNEAR |
| `near/pool` | Rust tUSD/tNEAR pool |
| `keeper/` | One-shot Rhea reader, and the testnet deploy script |
| `app/` | Next.js app with NEAR wallet-selector (MyNearWallet, HOT) |
| `shared/` | Card data, engine rulings, Rhea data, addresses |
| `contracts/` | The original Solidity/Monad contracts, kept as the reference for the engine test vectors |
| `cardsdotgg.md` | Original product and technical spec (written for Monad; the game rules still apply) |

## Run and test

```bash
pnpm install

# contracts
cd near
cargo test --workspace                                   # 31 tests, including 90 vectors from the Solidity engine
RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release --workspace

# keeper (reads Rhea on NEAR mainnet)
cd ../keeper
pnpm dry            # read only, writes shared/*.json
pnpm run-once       # also writes rates and the NEAR price to the testnet game contract (needs deploy first)

# app
cd ../app
pnpm dev --port 3000
pnpm test:game      # practice-game tests
pnpm typecheck
pnpm build
```

### Deploy to NEAR testnet

Needs a funded testnet account and a `.env` at the repo root (see `.env.example`). NEAR stakes about 1 NEAR per 100 KB of contract code; after wasm optimisation the four contracts are about 760 KB, so budget roughly 10 testnet NEAR. The owner account hosts the game contract; the two tokens and the pool each get a fresh implicit account funded by the script (keys go to the gitignored `keeper/.deploy-keys.json`).

```bash
cd near && RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release --workspace
cd ../keeper && pnpm dry
NEAR_OWNER_ID=you.testnet NEAR_OWNER_KEY=ed25519:... pnpm deploy-testnet   # deploys, funds reserve and liquidity, opens the pool
KEEPER_ACCOUNT_ID=... KEEPER_PRIVATE_KEY=... pnpm run-once                  # writes live Rhea rates and price
pnpm e2e                                                                    # two fresh players play a full loop
pnpm resolve:watch                                                          # auto-resolve matches and expire stale challenges
bash deploy/install-resolver.sh                                             # run the resolver as a systemd user service
```

## Local animated game

- `/`: three-round practice bracket with computer opponents, a Three.js card showcase, versus introduction, opening coin, animated dealing, attacks, energy, bench switches, knockouts and victory.
- `/packs`: free pack carousel and card reveals, with collection storage in this browser. Packs do not affect battles or send transactions.
- `/collection`: search and inspect all 102 supplied Base Set cards.
- `/play`, `/arena`, `/match/[id]`, `/leaderboard`: the onchain flows.

The practice arena, packs and collection work without a wallet and send no transactions. This is a reference-inspired implementation, not a complete Pokémon TCG rules engine. Card images are in `app/public/cards`.

## Prototype limits

- **Live-tested once.** The e2e loop passed on testnet, but the withdraw-failure restore, the quick-match and leaderboard pages, and wallet sign-in in a browser were not exercised live.
- **Owner is the keeper.** On this deployment one account is owner, keeper and host of the game contract. Use a separate keeper account for anything beyond a demo.
- **Randomness:** the seed mixes the block's `random_seed` with the match, and a resolver can choose which block to resolve in. It is prototype-only and not safe for real value.
- **Withdraw payouts:** `withdraw` updates state, then sends `ft_transfer` with a callback. If the transfer fails, the callback restores the deck, principal and escrow (covered by a unit test of the restore step, not yet seen on a live network).
- **Deck token:** decks are records in the game contract with an onchain SVG (`deck_svg`). They are not a NEP-171 NFT yet, so they do not show in NFT wallets.
- **Demo seed:** the owner can seed escrow from the reserve, labelled "includes demo seed", because real yield takes days to cover a stake.
- **Balance:** each pairing is within 40 to 60% over 1,000 matches (see `docs/agents/balance-report.md`). The 48 to 52% target was not met or tested.
- **Wallets:** Google sign-in is gone with Privy. Meteor wallet was dropped because its SDK is incompatible with the current near-api-js.
- **Third-party art:** `app/public/cards` and `app/lib/game/card-catalog.json` hold Pokémon TCG Base Set images and names. Confirm the rights before any release outside the hackathon.
- **Audit:** the contracts are unaudited testnet prototypes with no upgrade path.
- **Leftover docs:** `docs/agents/*` and `cardsdotgg.md` still describe the Monad build.
