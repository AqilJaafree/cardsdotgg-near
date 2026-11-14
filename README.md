<div align="center">

<img src="app/public/cardsdotgg-banner.jpg" alt="cardsdotgg: collect, build, battle" width="640" />

# cardsdotgg

**Yield-funded card battles on NEAR. Deposit, build a deck, win packs in the arcade, collect real graded cards, and duel turn by turn with every move recorded onchain.**

[![NEAR testnet](https://img.shields.io/badge/NEAR-testnet-00ec97?logo=near&logoColor=white)](https://testnet.nearblocks.io/address/9cc71b1795d97d7afedcf6ca6863a9134b9adb117301f79d84424d5471daf0f4)
[![Rust](https://img.shields.io/badge/contracts-Rust-b7410e?logo=rust&logoColor=white)](near)
[![Next.js](https://img.shields.io/badge/app-Next.js%2014-black?logo=nextdotjs)](app)
[![Yield data](https://img.shields.io/badge/yield%20data-Rhea%20pools-6c47ff)](#where-rhea-data-is-used)
[![Status](https://img.shields.io/badge/status-prototype-orange)](#known-limits)

[App tour](#app-tour) · [How it works](#how-it-works) · [Game rules](#game-rules) · [Architecture](#architecture) · [Quick start](#quick-start) · [Deploy](#deploy-the-app-to-netlify) · [Known limits](#known-limits)

</div>

> Test tokens have no real value. The contracts are unaudited prototypes on NEAR testnet. The one exception is **Buy with NEAR** on graded cards, which spends real NEAR on mainnet.

## Table of contents

- [Overview](#overview)
- [App tour](#app-tour)
- [How it works](#how-it-works)
- [Game rules](#game-rules)
- [Architecture](#architecture)
- [Live contracts](#live-contracts-near-testnet)
- [Quick start](#quick-start)
- [Deploy to NEAR testnet](#deploy-to-near-testnet)
- [Deploy the app to Netlify](#deploy-the-app-to-netlify)
- [Where Rhea data is used](#where-rhea-data-is-used)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Known limits](#known-limits)
- [Credits](#credits)

## Overview

cardsdotgg is a trading-card battler where your deck is a DeFi position. You put test tokens into a vault and get a deck. The deck earns yield at rates taken from real [Rhea](https://rhea.finance) pools, and that yield, never your principal, is what you stake in matches. Two players then duel turn by turn, and each move, the winner, the stakes and the ratings are settled by a NEAR smart contract.

- **A deck is a vault position.** Pick Guardian (steady), Balanced or Degen (risky). Principal never moves in a match.
- **24 original creatures with real abilities.** Stats and abilities come from the product spec in [`cardsdotgg.md`](cardsdotgg.md).
- **Collect and customize.** Packs unlock more creatures and pictures. Rare pictures give a small HP perk. Ownership is checked by the contract.
- **Win packs in the arcade.** Stacker is free and earns Pack Tickets (3 a day). The Claw costs 2 tUSD and earns a Season Ticket. Every pack opens with a ticket.
- **Real cards, one of one.** The White Flare season pack holds 23 real physical cards, each minted to its puller as a NEP-171 NFT on NEAR. Win the Claw and your card is 75% likely to be rare.
- **Graded cards in the market.** The 5 cheapest graded Pokémon cards on Collector Crypt and on Magic Eden, bought with NEAR through NEAR Intents.
- **Play without signing every move.** Matchmaking adds a restricted "quick play" key, so a duel has no wallet pop-ups.
- **Practice for free.** Practice plays the same rules against the computer, with your own saved deck, and sends nothing to the chain.

> **Status:** deployed on NEAR testnet and exercised end to end (claim, deposit, seed, challenge, accept, resolve, replay, withdraw), plus a full turn-based duel with session keys only (`pnpm e2e:duel`), a free arcade ticket opening a trial pack with ownership checks (`pnpm e2e:packs`), and the claw-to-NFT season flow (`pnpm e2e:season`). Players have pulled 8 of the 23 White Flare cards on testnet.

## App tour

Screens are shown at phone size with sample data. The app is built phone-first and also works on a laptop.

### Play

<table>
<tr>
<td width="25%"><img src="docs/screenshots/menu.jpg" alt="Main menu" /></td>
<td width="25%"><img src="docs/screenshots/practice.jpg" alt="Practice battle" /></td>
<td width="25%"><img src="docs/screenshots/lobby.jpg" alt="Lobby" /></td>
<td width="25%"><img src="docs/screenshots/lobby-waiting.jpg" alt="Waiting for a player" /></td>
</tr>
<tr>
<td valign="top"><b>Main menu.</b> Pick a deck type, then BATTLE (online), PRACTICE, ARCADE, MARKET or COLLECTION. The deck label says TRIAL DECK until you own one, then YOUR TRIAL DECK #id.</td>
<td valign="top"><b>Practice.</b> The real duel rules against the computer. Uses your saved deck when you are signed in, otherwise the starter deck. Nothing is sent to the chain.</td>
<td valign="top"><b>Lobby.</b> Shows the deck you will bring. FIND OPPONENT asks your wallet once and turns on quick play. Rating, Settings and the leaderboard sit at the top.</td>
<td valign="top"><b>Waiting.</b> Your deck is in the lobby. The fight starts the moment another player joins. Leave any time.</td>
</tr>
</table>

<table>
<tr>
<td width="25%"><img src="docs/screenshots/duel.jpg" alt="Online duel" /></td>
<td width="25%"><img src="docs/screenshots/settings.jpg" alt="Settings" /></td>
<td width="25%"><img src="docs/screenshots/result.jpg" alt="Result" /></td>
<td width="25%"><img src="docs/screenshots/replay.jpg" alt="Replay" /></td>
</tr>
<tr>
<td valign="top"><b>The duel.</b> Your active card in the middle, bench below, hand at the bottom. Attach, Attack and Power show what they do or why they are locked. A whole turn is one transaction.</td>
<td valign="top"><b>Settings.</b> Turn quick play on or off, mute sound, or forfeit. The only place these controls live.</td>
<td valign="top"><b>Result.</b> Labelled score, then Claim rewards (collects yield and ends quick play), Replay, or Play again.</td>
<td valign="top"><b>Replay.</b> Watch the match back on the same board with the same cinematics: Play, Pause, Next, Restart.</td>
</tr>
</table>

### Build

<table>
<tr>
<td width="33%"><img src="docs/screenshots/my-decks.jpg" alt="My decks" /></td>
<td width="33%"><img src="docs/screenshots/deck-builder.jpg" alt="Deck builder" /></td>
<td width="33%"><img src="docs/screenshots/card-sheet.jpg" alt="Card sheet" /></td>
</tr>
<tr>
<td valign="top"><b>My Decks.</b> A swipeable carousel, one deck per slide, with its coins, battle wallet, and the BATTLE, CUSTOMIZE CARDS and COLLECT REWARDS buttons at one size.</td>
<td valign="top"><b>Deck builder.</b> The deck laid out as it plays: one Leader, three Bench, four Hand. Each card appears once. Tap any card to change it.</td>
<td valign="top"><b>Card sheet.</b> Make it leader, swap it for another card (locked creatures show a padlock), or change how it looks. Save appears only when something changed.</td>
</tr>
</table>

### Collect

<table>
<tr>
<td width="25%"><img src="docs/screenshots/packs.jpg" alt="Pack room" /></td>
<td width="25%"><img src="docs/screenshots/pack-opened.jpg" alt="Pack opened" /></td>
<td width="25%"><img src="docs/screenshots/white-flare.jpg" alt="White Flare collection" /></td>
<td width="25%"><img src="docs/screenshots/wallet.jpg" alt="Wallet" /></td>
</tr>
<tr>
<td valign="top"><b>Packs.</b> Trial packs (Guardian, Balanced, Degen) open with a Pack Ticket. The White Flare tab opens with a Season Ticket and shows the season window and how many real cards are left.</td>
<td valign="top"><b>Pack opened.</b> A reveal one card at a time. A trial pack marks what is NEW, each picture's HP perk and any creature you unlocked. A White Flare pack flips the photo of your real card.</td>
<td valign="top"><b>Collection.</b> All 102 trial pictures, marked Trial deck, Trial pack, Trial or Locked. The White Flare tab shows the 23 real cards: Yours (with Send), Pulled or In packs.</td>
<td valign="top"><b>Wallet.</b> Your testnet account (with Copy), the live NEAR balance, GET TESTNET NEAR (NEAR's official faucet) and Sign out.</td>
</tr>
</table>

### Arcade and market

<table>
<tr>
<td width="25%"><img src="docs/screenshots/arcade.jpg" alt="Arcade" /></td>
<td width="25%"><img src="docs/screenshots/stacker.jpg" alt="Stacker" /></td>
<td width="25%"><img src="docs/screenshots/claw.jpg" alt="Claw" /></td>
<td width="25%"><img src="docs/screenshots/market.jpg" alt="Market" /></td>
</tr>
<tr>
<td valign="top"><b>Arcade.</b> Two machines and your tickets: Pack, Season and free plays left today. Each machine has a Rules sheet.</td>
<td valign="top"><b>Stacker (free).</b> Stop each row on the one below and reach the top. Win or lose, every play earns a Pack Ticket, up to 3 a day.</td>
<td valign="top"><b>Claw (2 tUSD).</b> Drop the claw on a capsule. Win or lose you get a Season Ticket; a grab makes a rare White Flare card 75% likely, a miss 25%.</td>
<td valign="top"><b>Market.</b> Redeem tickets for packs, buy graded cards, and see what is coming soon (Season 2 pack, card sleeves, booster box).</td>
</tr>
</table>

<table>
<tr>
<td width="25%"><img src="docs/screenshots/graded-cards.jpg" alt="Graded cards" /></td>
<td width="75%" valign="top">
<b>Graded cards.</b> The 5 cheapest graded Pokémon cards on Collector Crypt and on Magic Eden, listed next to the packs with a GRADED CARD tag, the price in USD and an estimate in NEAR.<br /><br />
<b>Buy with NEAR.</b> Paste your card wallet address, connect a NEAR <b>mainnet</b> wallet and get a live NEAR Intents quote. One NEAR transaction delivers the price plus 5% for marketplace fees to your card wallet in about 20 seconds, then the button opens the listing so you complete the buy there.
</td>
</tr>
</table>

Other screens: **Get Coins** (claim free test tokens and make a deck), **Cash Out** (withdraw), **Swap** (the tUSD/tNEAR pool), **Friends** (challenge a named account) and the **Leaderboard**.

## How it works

```mermaid
flowchart LR
  A[Claim free coins] --> B[Deposit 10+ tUSD]
  B --> C[Get a deck<br/>Guardian / Balanced / Degen]
  C --> T[Arcade<br/>Stacker free / Claw 2 tUSD]
  T --> D[Open packs with tickets<br/>unlock creatures, pictures, real cards]
  D --> E[Customize the deck]
  E --> F{Play}
  F -->|free| G[Practice vs the computer]
  F -->|onchain| H[Lobby and duel]
  H --> I[Result: winner, stakes, Elo]
  I --> J[Claim rewards / Replay / Play again]
  C --> K[Yield accrues to escrow]
  K --> H
  C --> L[Withdraw principal + escrow]
```

1. **Claim and deposit.** Claim tUSD or tNEAR once per 24 hours, then deposit at least 10 tUSD of value (tNEAR is valued at the Rhea-derived price) to mint a deck. A deposit is one `ft_transfer_call`: no approve step.
2. **Earn.** Yield accrues to the deck's escrow in tUSD at the oracle rate, paid from a reserve the owner funded. Collect it any time from My Decks.
3. **Play the arcade, open packs.** A free Stacker play earns a Pack Ticket, which opens a trial pack: 5 pictures and 1 creature in your onchain collection. A 2 tUSD Claw play earns a Season Ticket, which opens the White Flare pack: one real card as an NFT. See [Packs, tickets and perks](#packs-tickets-and-perks).
4. **Customize.** In the deck builder pick 8 different creatures and a picture for each. The contract refuses a creature or picture you have not unlocked.
5. **Practice (optional).** Play the computer with your deck to test it. Free, and no wallet needed.
6. **Battle.** Tap FIND OPPONENT to open a lobby, or JOIN BATTLE on one that is waiting. Each player stakes 0.1% of their deposit from escrow. If either side is short, the match is Rank-only.
7. **Duel.** Players alternate turns. A turn is a few moves (attach Energy, retreat) and an attack, sent as one transaction. The duel ends at 3 knockouts, a forfeit, or after 5 minutes of silence.
8. **Settle.** In the transaction that ends the duel, the contract records the winner, pays the winner 95% of the loser's stake (5% to the prize pool) and updates Elo (start 500, K=32).
9. **Review.** Claim rewards, watch the Replay, or Play again.
10. **Withdraw.** A full withdraw retires the deck and pays principal plus remaining escrow, in tUSD or tNEAR at the oracle price.

The **Swap** page is a separate tUSD/tNEAR constant-product pool (0.3% fee that stays in the reserves). Swaps are one signature: `ft_transfer_call` with `{"action":"swap","min_out":...}` and the output is paid straight to the wallet. Adding liquidity sends both tokens in one wallet approval. Remove and withdraw is one transaction.

### Quick play (no pop-up per move)

Signing every move would be unplayable, so matchmaking sets up a session key.

- **One approval.** `FIND OPPONENT` and `JOIN BATTLE` ask the wallet once. That approval also adds a restricted function-call key to your account.
- **A boxed-in key.** The chain limits it to the game contract and to `play_turn`, `play`, `forfeit` and `claim_timeout`, with no deposit and a 0.25 NEAR gas allowance. It cannot move coins, withdraw or change a deck. A whole match used about 0.002 NEAR of its allowance.
- **No pop-ups.** The app signs moves with the key, in the browser. If the key is revoked or used up, it falls back to the wallet.
- **You stay in control.** Settings turns it off (removes the key). Claim rewards on the result screen collects yield and ends it. The key lives in the browser's localStorage.

If a wallet cannot read the bundled add-key or remove-key approval, the app stops bundling and plays on with normal approvals. Before it retries a call it checks the chain, so a join or a search is never sent twice.

### Wallet signatures

The app bundles where NEAR allows it: several actions to one contract share one transaction, and several transactions share one wallet approval (`signAndSendTransactions`). Claim both tokens is 1 approval, a first-time tNEAR withdraw is 1, a pool swap is 1, adding liquidity is 1, remove + withdraw is 1. Transfers that attach the 1 yoctoNEAR deposit always prompt the wallet.

## Game rules

The duel rules live in [`near/game/src/duel.rs`](near/game/src/duel.rs) and are ported line for line to [`app/lib/game/duelEngine.ts`](app/lib/game/duelEngine.ts), so practice plays by the same rules. They build on the spec engine in [`cardsdotgg.md`](cardsdotgg.md) and [`shared/engine-rules.md`](shared/engine-rules.md).

| | |
| --- | --- |
| **Board** | 8 cards per side: 1 active, 3 on the bench, 4 in hand. A knockout promotes the first bench card and refills the bench from the hand. |
| **Who goes first** | The higher SPD. Ape Comet always leads, Basis Kestrel borrows a faster enemy's SPD, ties roll. |
| **Your turn** | Attach 1 Energy (once). Retreat to a bench card (once, costs 1 Energy). Then attack, which ends the turn. |
| **Attacks** | A basic attack needs 1 Energy. A power attack needs 3. Energy caps at 5. |
| **Damage** | The spec formula `ATK*1000/(50+DEF)`, then +15% per Energy, power x1.6, the class wheel (x1.25 strong, x0.8 weak), 90-110% variance, tier crit, then abilities. |
| **Crit** | By deck type: Guardian 5% x1.3, Balanced 12% x1.5, Degen 25% x1.8. |
| **Abilities** | All 24 from the spec. "Each round" abilities fire once per owner turn. |
| **Win** | 3 knockouts, or the other side runs out of cards. A forfeit or 5 minutes of silence also loses. |

The class wheel is Stable > Treasury > Gold > Credit > BTC > Stable. The class wheel and the Energy, power and retreat numbers are new to this build and need playtesting.

### Packs, tickets and perks

- **Every pack opens with a ticket.** Packs can no longer be bought directly with tUSD; the contract refuses it and returns the tUSD.
- **Pack Ticket:** each free Stacker play earns one, up to **3 per wallet per UTC day** (`arcade_free_play`). It opens one trial pack (`open_pack`): 2 common, 2 uncommon and 1 rare picture, plus 1 creature.
- **Season Ticket:** each paid Claw play (**2 tUSD**, to the prize pool) earns one after its result is reported (`arcade_claw_result`). It opens one White Flare pack (`open_season_pack`).
- **Creatures:** a deck can always use its own type's 8 starter creatures. Any other creature must be unlocked.
- **Pictures:** a card's picture must be one of the 24 printed on the starter decks, or unlocked. Each picture can be used once per deck.
- **HP perk:** a picture unlocked from a pack adds max HP to its card, rare +5% and uncommon +2%. Starter pictures and the default give nothing.

### White Flare season (real cards)

- **23 physical cards, one of each,** loaded on-chain as the season stock (`set_rwa_stock`). A season pack mints exactly one of them to the buyer and removes it from the stock, so no card goes out twice; the pack sells out at zero.
- **Season window:** the pack opens only between the season's start and end (`set_season`, about two months). The contract enforces it.
- **Rare odds:** 8 cards printed Uncommon or above are rare (`set_rwa_rare`). A won Claw ticket draws a rare card 75% of the time, a lost one 25%, from the block's random seed. The win itself is reported by the app.
- **NEP-171 NFTs:** the cards are standard NEAR NFTs inside the game contract: NEP-171 core, NEP-177 metadata (title, photo, set and number), NEP-178 approvals for marketplaces, NEP-181 enumeration and NEP-297 events. Holders can send them from the collection.
- **Collectibles only:** they are not deck pictures and give no battle perk.

### Graded cards (NEAR Intents)

- **Listings:** the 5 cheapest graded Pokémon cards on [Collector Crypt](https://collectorcrypt.com)'s marketplace (priced in USDC) and on [Magic Eden](https://magiceden.io)'s `collector_crypt` collection (priced in SOL), read straight from their public APIs in the browser.
- **Payment:** [NEAR Intents](https://docs.near-intents.org) 1Click on **mainnet**. A live quote gives a deposit address; one NEAR transaction to `wrap.near` wraps the quoted NEAR and sends it there, and NEAR Intents delivers the price plus 5% to the buyer's card wallet. If it cannot complete, it refunds the NEAR.
- **The buy itself** happens on the marketplace with that wallet: NEAR Intents can deliver the funds but cannot sign the marketplace purchase.
- **A separate wallet connection:** mainnet sign-in is kept apart from the testnet game session and is only used for this.

## Architecture

```mermaid
flowchart TB
  subgraph Browser[Next.js app]
    UI[Game UI<br/>menu, lobby, duel, builder,<br/>arcade, market, packs]
    ENG[duelEngine.ts<br/>practice, same rules]
    SK[Session key<br/>signs moves locally]
  end
  W[NEAR wallet<br/>near-connect: Meteor, HOT, MyNearWallet]
  subgraph Chain[NEAR testnet]
    G[game contract<br/>oracle, vault, escrow, arena,<br/>duels, packs, Elo]
    T[tUSD and tNEAR<br/>NEP-141]
    P[pool<br/>tUSD/tNEAR]
  end
  K[Keeper<br/>reads Rhea, writes rates,<br/>resolves old-style matches]
  MKT[(Collector Crypt and<br/>Magic Eden listings)]
  NI[NEAR Intents 1Click<br/>mainnet]
  R[(Rhea pools<br/>NEAR mainnet)]
  UI --> W --> G
  SK --> G
  UI --> ENG
  UI -. reads .-> G
  G <--> T
  P <--> T
  K --> G
  R --> K
  UI -. reads .-> MKT
  UI -->|Buy with NEAR, mainnet| NI
```

| Part | What it does |
| --- | --- |
| **`near/game`** | One contract: rate oracle, deck vault, yield escrow, arena, Elo, onchain deck SVG, the auto-battle engine (a port of the Solidity engine), turn-based duels (`duel.rs`), packs (`collection.rs`), arcade tickets (`arcade.rs`), the White Flare stock (`rwa.rs`) and its NEP-171 NFTs (`nft.rs`). It lives on one account because NEAR calls between contracts are asynchronous and the state must change together. |
| **`near/ft`** | A NEP-141 test token with a 24h `claim`. Deployed twice, as tUSD and tNEAR. |
| **`near/pool`** | The tUSD/tNEAR constant-product pool. |
| **`keeper/`** | Reads Rhea on mainnet and writes rates and the NEAR price to the game contract, resolves old-style matches, and holds the deploy and e2e scripts. |
| **`app/`** | The Next.js app: UI, the local practice engine, wallet and session-key code, the arcade games, and the graded-card listings and NEAR Intents client. |
| **`shared/`** | Card data, engine rulings, Rhea snapshots, addresses. |

**Game contract methods**

| Area | Methods |
| --- | --- |
| Vault | `ft_on_transfer` (`deposit`, `reserve`, `liquidity`, `arcade_claw`), `checkpoint`, `withdraw`, `quote_withdraw`, `seed_escrow` |
| Oracle | `set_rates`, `reset_rates`, `set_near_price`, `oracle` |
| Duels | `create_challenge`, `accept_duel`, `play`, `play_turn`, `forfeit`, `claim_timeout`, `cancel`, `expire`, `get_duel`, `get_match`, `recent_matches` |
| Auto-battle | `accept`, `resolve`, `simulate`, `simulate_with_log` |
| Decks and packs | `set_deck_cards`, `get_deck_cards`, `get_collection`, `open_pack`, `pack_price`, `decks_of`, `deck_svg` |
| Arcade | `arcade_free_play`, `arcade_claw_result`, `get_tickets`, `arcade_info` |
| Season (real cards) | `set_season`, `get_season`, `set_rwa_stock`, `set_rwa_rare`, `open_season_pack`, `season_pack_price`, `rwa_stock`, `rwa_all`, `rwa_tokens_of`, `rwa_redeem` |
| NFTs (NEP-171/177/178/181) | `nft_transfer`, `nft_transfer_call`, `nft_token`, `nft_metadata`, `nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`, `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner`, `set_nft_config` |
| Ratings | `rating_of`, `players`, `player_count` |

Contract changes are made so existing state keeps loading: new data goes in new storage maps, and older records are still read and converted.

## Live contracts (NEAR testnet)

| Contract | Account |
| --- | --- |
| game (oracle, vault, escrow, arena, duels, packs, arcade, White Flare NFTs) | `9cc71b1795d97d7afedcf6ca6863a9134b9adb117301f79d84424d5471daf0f4` |
| tUSD | `7d06f44ba61478f74028c9d8699a23e7c131f5f3379c2a311cc0a202b4bb303e` |
| tNEAR | `0614bb856676794695de6f15e98539e9d4a3763090fb7bb194e2cc0c67b9ad30` |
| pool (tUSD/tNEAR) | `d1cf94d90fecf6894df4077d1d0b7ef7a6ce59d0dc336c68bae66136df5b0cad` |

Explorer: <https://testnet.nearblocks.io>. NEAR keeps one contract per account, so the game contract lives on the owner account and the other three on implicit accounts.

NEAR needs wasm built with `--cfg near` (what `cargo near build` sets). A plain `cargo build` produces wasm whose panics have no message, so errors in the app show as a generic crash. Build with `RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release --workspace`.

## Quick start

**Prerequisites:** Node (v22 was used) and pnpm, Rust with the `wasm32-unknown-unknown` target, and a NEAR testnet wallet (Meteor, HOT or MyNearWallet).

```bash
pnpm install

# contracts
cd near
cargo test --workspace                     # 65 game tests
RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release --workspace

# app
cd ../app
pnpm dev --port 3000                       # http://localhost:3000
pnpm typecheck
pnpm test:game                             # old practice-game tests
pnpm test:duel                             # the TypeScript duel engine
NEXT_DIST_DIR=.next-test pnpm dev --port 3011   # a second dev server without touching the first one's .next

# keeper (reads Rhea on NEAR mainnet)
cd ../keeper
pnpm dry                                   # read only, writes shared/*.json
pnpm run-once                              # also writes rates and the NEAR price to the testnet game contract
```

**First run in the app:** open `/`, tap PRACTICE to play right away with no wallet. To play online, tap BATTLE, connect a wallet, then GET COINS (claim free coins, make a deck) and FIND OPPONENT. You also need a little testnet NEAR for fees: open the wallet sheet (top right) and tap GET TESTNET NEAR, which opens [NEAR's official faucet](https://docs.near.org/getting-started/faucet). Then play Stacker in the ARCADE for free Pack Tickets.

### Deploy to NEAR testnet

Needs a funded testnet account and a `.env` at the repo root (see `.env.example`). NEAR stakes about 1 NEAR per 100 KB of contract code; after wasm optimisation the four contracts are about 760 KB, so budget roughly 10 testnet NEAR. The owner account hosts the game contract. The two tokens and the pool each get a fresh implicit account funded by the script (keys go to the gitignored `keeper/.deploy-keys.json`).

```bash
cd near && RUSTFLAGS="--cfg near -C link-arg=-s" cargo build --target wasm32-unknown-unknown --release --workspace
cd ../keeper && pnpm dry
NEAR_OWNER_ID=you.testnet NEAR_OWNER_KEY=ed25519:... pnpm deploy-testnet   # deploys, funds reserve and liquidity, opens the pool
KEEPER_ACCOUNT_ID=... KEEPER_PRIVATE_KEY=... pnpm run-once                  # writes live Rhea rates and price
CODE_ONLY=1 ONLY=game pnpm deploy-testnet                                   # later: replace only the game contract's code, keeping its state
pnpm e2e                                                                    # two fresh players play a full loop
pnpm e2e:duel                                                               # a whole duel with session keys only (needs ~0.4 testnet NEAR)
pnpm e2e:packs                                                              # earn a free ticket, open a pack, check unlocks and ownership (needs ~0.2 testnet NEAR)
pnpm set-season && pnpm set-rwa-stock && pnpm set-rwa-rare && pnpm set-nft-config   # owner: open the season, load the 23 cards, rare ids and NFT image paths
CONSUME_STOCK=1 pnpm e2e:season                                             # claw play, then a season pack (gives one real card to a test account)
pnpm resolve:watch                                                          # auto-resolve old-style matches and expire stale lobbies
bash deploy/install-resolver.sh                                             # run the resolver as a systemd user service
```

The keeper's resolver (`pnpm resolve:watch`) only matters for the older auto-battle path (`accept` then `resolve`). Duels need no resolver: the contract settles them in the final move.

## Deploy the app to Netlify

The repo has a [`netlify.toml`](netlify.toml) for the Next.js app in `app/`. Netlify detects Next.js and adds its runtime by itself.

| Setting | Value |
| --- | --- |
| Base directory | `app` |
| Build command | `pnpm build` (runs `scripts/sync-shared.mjs` first, which copies `shared/` into `app/lib/shared`) |
| Publish directory | `.next` |
| Node | 22 |
| Environment variables | None. Contract addresses come from `shared/addresses.json`; the listing and NEAR Intents APIs need no keys. |

1. In Netlify, **Add new site → Import an existing project** and pick this repository. The settings above are read from `netlify.toml`.
2. Deploy. Every page is static except `/match/[id]`, which Netlify serves as a function.
3. After the first deploy, set the NFT image base so wallets can show the White Flare photos: `cd keeper && NFT_BASE_URI=https://<your-site>.netlify.app pnpm set-nft-config`.

Checked locally with `pnpm build` (16 routes, no errors).

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

## Project layout

| Path | Contents |
| --- | --- |
| `near/game` | The game contract. `duel.rs` (duels), `collection.rs` (packs and ownership), `engine.rs` (auto-battle), `elo.rs`, `svg.rs`, `lib.rs` |
| `near/ft` | NEP-141 test token with a 24h `claim`; deployed twice as tUSD and tNEAR |
| `near/pool` | tUSD/tNEAR pool |
| `keeper/` | Rhea reader, deploy script, resolver, the e2e scripts (`e2e.ts`, `e2e-duel.ts`, `e2e-packs.ts`, `e2e-season.ts`) and the season setup scripts (`set-season.ts`, `set-rwa-stock.ts`, `set-rwa-rare.ts`, `set-nft-config.ts`) |
| `app/app` | Pages: `/` menu and practice, `/play`, `/match/[id]`, `/decks`, `/decks/build`, `/arcade`, `/market`, `/packs`, `/collection`, `/deposit`, `/withdraw`, `/pool`, `/arena`, `/leaderboard` |
| `app/components/game` | The battle screen (`OnlineBattle`, shared by online duels and practice), `PracticeBattle`, `ReplayBattle`, `SettingsSheet`, `DeckCarousel`, `CreatureCard`, `PackRoom`, `Arcade` (Stacker and Claw), `Market`, `GradedCards`, `SeasonCollection` |
| `app/lib` | `wallet.tsx` (wallet and quick play), `session-core.ts`, `game/duelEngine.ts` (the local engine), `game/duelView.ts` (replay), `game/useCollection.ts`, `game/arcade.ts` (tickets), `game/rwa.ts` and `game/rwa-catalog.json` (the 23 real cards), `solana/` (graded-card listings, NEAR Intents client, mainnet wallet) |
| `app/public/cards/wf-token` | Photos of the 23 White Flare cards and the pack cover |
| `shared/` | Card data, engine rulings, Rhea data, addresses |
| `docs/screenshots` | The images in this README |
| `contracts/` | The original Solidity/Monad contracts, kept as the reference for the engine test vectors |
| `cardsdotgg.md` | The original product and technical spec (written for Monad; the game rules still apply) |

## Testing

| Suite | Command | What it covers |
| --- | --- | --- |
| Contract | `cd near && cargo test --workspace` | 65 tests: 90 Solidity engine vectors, duel rules, every deck matchup played to a result, custom decks, packs and ownership, perks, arcade tickets and the daily cap, the claw's 75%/25% odds, the season window and stock, NEP-171/177/178/181 NFTs, forfeit, timeout, and loading older stored data |
| Duel engine (TS) | `cd app && pnpm test:duel` | 10 tests mirroring the contract's duel tests, plus the computer playing every matchup |
| Practice (old) | `cd app && pnpm test:game` | 6 tests of the earlier practice simulation |
| Types | `cd app && pnpm typecheck` | The whole app |
| Live, duel | `cd keeper && pnpm e2e:duel` | A full duel on testnet signed only by session keys, and the key refused for other methods |
| Live, packs | `cd keeper && pnpm e2e:packs` | Earns a free Pack Ticket, opens a trial pack with it, checks the unlock, and that unowned cards are refused |
| Live, season | `cd keeper && CONSUME_STOCK=1 pnpm e2e:season` | A paid claw play, its result, and a season pack minting one real card as an NFT (uses up one card from the stock) |

## Known limits

- **Prototype.** The contracts are unaudited testnet prototypes with no upgrade path, and the owner is also the keeper and the host of the game contract.
- **Randomness.** Seeds come from the block's `random_seed`, and a caller can choose which block to act in. This covers match seeds, duel rolls, pack contents and which White Flare card a season pack draws. It is not safe for real value.
- **Duel balance is untuned.** The class wheel and the Energy, power and retreat numbers are new. In a greedy-bot test Guardian lost most games, and a Guardian mirror takes about 30 turns. The spec target of each pairing winning 48 to 52% is not met.
- **Arcade results.** The Claw's win is reported by the app, so a player calling the contract directly could always claim a win and get the 75% rare odds. Every Season Ticket still costs a 2 tUSD play. Free Pack Tickets are capped at 3 per wallet per day.
- **Real cards.** The White Flare cards are real items held by the project. Redeeming one only marks the token on-chain; shipping, and collecting a delivery address privately, are handled off-chain. Paid random packs of real-value items can count as gambling in some places; check before a mainnet launch.
- **Graded cards are mainnet.** Buy with NEAR spends real NEAR, the listing can sell before the buyer completes it (the funds stay in their card wallet), and Collector Crypt's API is undocumented: the cheapest five come from scanning listed cards up to 250 USDC and sorting them in the app.
- **Replay HP is approximate.** The move log records damage dealt but not HP afterwards, so the replay rebuilds HP and can be slightly off for cards that heal or reflect damage. Who is active, the bench, points and Energy are exact.
- **Wallets.** Sign-in goes through `@hot-labs/near-connect`. Quick play's bundled key approval was reported to fail in Meteor, where moves then ask for approval. The cause is unconfirmed.
- **RPC rate limits.** The free FastNEAR endpoint refuses after a burst of about 8 requests from one IP, and the browser shows that 429 as a CORS error. The app polls about 16 requests a minute in the lobby and 12 in a battle. A FastNEAR API key would remove the limit.
- **Not fully live-tested.** The real wallet approval for adding the session key, the deck builder's save, claim and replay on a real match, and the pack purchase through a wallet were checked with mocks or by script, not in a browser against a live wallet.
- **Art and names.** `app/public/cards` and `app/lib/game/card-catalog.json` hold Pokémon TCG Base Set images and names, while the 24 spec creatures have no art of their own. A picture can show a different printed name than the card's game name. Confirm the rights before any release outside the hackathon.
- **Deck token.** Decks are records in the game contract with an onchain SVG (`deck_svg`), not NEP-171 NFTs, so they do not show in NFT wallets. The White Flare cards are NEP-171 NFTs, but their images need `NFT_BASE_URI` set to the deployed app before wallets can show them.
- **Demo seed.** The owner can seed escrow from the reserve, labelled "includes demo seed", because real yield takes days to cover a stake.
- **Withdraw payouts.** `withdraw` updates state, then sends `ft_transfer` with a callback that restores the deck if the transfer fails. This is covered by a unit test, not yet seen on a live network.
- **Leftover docs.** `docs/agents/*` and `cardsdotgg.md` still describe the Monad build.

## Credits

- Game design and rules: [`cardsdotgg.md`](cardsdotgg.md).
- Yield and price data: [Rhea](https://rhea.finance) pools on NEAR mainnet.
- Graded card listings: [Collector Crypt](https://collectorcrypt.com) and [Magic Eden](https://magiceden.io). Cross-chain payment: [NEAR Intents](https://docs.near-intents.org).
- Wallet connection: [`@hot-labs/near-connect`](https://github.com/hot-dao/near-selector). Contracts built on [near-sdk-rs](https://github.com/near/near-sdk-rs).
- Started at Monad Blitz Devcon Mumbai and rebuilt for NEAR.
