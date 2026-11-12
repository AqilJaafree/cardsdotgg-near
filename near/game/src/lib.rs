//! Cardsdotgg on NEAR: one contract holding the rate oracle, deck vault, yield escrow and arena.
//!
//! This replaces the Monad contracts (RateOracle, DeckVault, DeckNFT, YieldEscrow, Arena, BattleEngine, WithdrawRouter).
//! NEAR calls between contracts are asynchronous, so everything that has to change together lives here and settles in
//! one transaction. Tokens are NEP-141: deposits arrive through `ft_on_transfer`, payouts leave through `ft_transfer`.
//!
//! Accounting invariant for tUSD held by this contract:
//!   balance = reserve + liquidity[0] + total_principal[0] + prize_pool + sum(deck escrow) + sum(deck locked)
pub mod card_data;
pub mod elo;
pub mod engine;
pub mod svg;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub const MIN_DEPOSIT_USD: u128 = 10_000_000; // 10 tUSD, 6 decimals
pub const MAX_DECKS: u32 = 5;
pub const CHALLENGE_TTL_SECS: u64 = 3600;
pub const START_RATING: u32 = 500;
pub const MAX_BPS: u16 = 5000;
pub const STEP_BPS: u16 = 200;
pub const STALE_AFTER_SECS: u64 = 24 * 3600;
const YEAR_BPS: u128 = 10_000 * 365 * 86_400;
const NEAR_UNIT: u128 = 1_000_000_000_000_000_000_000_000; // 1e24 yocto per tNEAR
const TUSD: u8 = 0;
const TNEAR: u8 = 1;

#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum Msg {
    Deposit { tier: u8 },
    Reserve,
    Liquidity,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Deck {
    owner: AccountId,
    tier: u8,
    asset: u8,
    principal: u128,
    deposit_value_usd: u128,
    deposited_at: u64,
    retired: bool,
    escrow: u128,
    locked: u128,
    seeded: u128,
    last_cum: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Match {
    deck_a: u64,
    deck_b: u64,
    player_a: AccountId,
    player_b: Option<AccountId>,
    opponent: Option<AccountId>,
    stake_a: u128,
    stake_b: u128,
    seed: Option<[u8; 32]>,
    status: u8, // 0 Open, 1 AwaitingSeed, 3 Resolved, 4 Expired (2 is unused, kept for the app's status table)
    created_at: u64,
    seed_block: u64,
    winner: Option<AccountId>, // None on a draw
}

const OPEN: u8 = 0;
const AWAITING: u8 = 1;
const RESOLVED: u8 = 3;
const EXPIRED: u8 = 4;

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DeckView {
    pub id: U64,
    pub owner: AccountId,
    pub tier: u8,
    pub asset: u8,
    pub principal: U128,
    pub deposit_value_usd: U128,
    pub deposited_at: U64,
    pub retired: bool,
    /// Escrow including yield accrued since the last checkpoint.
    pub available: U128,
    pub locked: U128,
    pub seeded: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MatchView {
    pub id: U64,
    pub deck_a: U64,
    pub deck_b: U64,
    pub player_a: AccountId,
    pub player_b: Option<AccountId>,
    pub opponent: Option<AccountId>,
    pub stake_a: U128,
    pub stake_b: U128,
    pub seed: Option<String>,
    pub status: u8,
    pub created_at: U64,
    pub seed_block: U64,
    pub winner: Option<AccountId>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct OracleView {
    pub rates_bps: [u16; 3],
    pub last_update: U64,
    pub stale: bool,
    pub source_block: U64,
    pub usd_per_near_1e6: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PlayerView {
    pub account: AccountId,
    pub rating: u32,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Quote {
    pub principal_out: U128,
    pub escrow_out: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SimView {
    pub winner_side: u8,
    pub rounds: u8,
    pub hp_share_a: u16,
    pub hp_share_b: u16,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Game {
    owner: AccountId,
    keeper: AccountId,
    tusd: AccountId,
    tnear: AccountId,

    // oracle
    rates: [u16; 3],
    cumulative: [u128; 3],
    cumulative_at: u64,
    last_update: u64,
    keeper_has_written: bool,
    source_block: u64,
    near_price: u128, // USD per whole tNEAR, 6 decimals

    // vault and escrow
    reserve: u128,
    liquidity: [u128; 2],
    total_principal: [u128; 2],
    deck_count: u64,
    decks: LookupMap<u64, Deck>,
    owned: LookupMap<AccountId, Vec<u64>>,
    active_decks: LookupMap<AccountId, u32>,

    // arena
    match_count: u64,
    prize_pool: u128,
    matches: LookupMap<u64, Match>,
    ratings: LookupMap<AccountId, u32>,
    players: Vector<AccountId>,
}

fn now() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl Game {
    #[init]
    pub fn new(owner: AccountId, keeper: AccountId, tusd: AccountId, tnear: AccountId, rates_bps: [u16; 3], usd_per_near_1e6: U128) -> Self {
        require!(usd_per_near_1e6.0 > 0, "near price");
        let t = now();
        Self {
            owner,
            keeper,
            tusd,
            tnear,
            rates: rates_bps.map(|r| r.min(MAX_BPS)),
            cumulative: [0; 3],
            cumulative_at: t,
            last_update: t,
            keeper_has_written: false,
            source_block: 0,
            near_price: usd_per_near_1e6.0,
            reserve: 0,
            liquidity: [0; 2],
            total_principal: [0; 2],
            deck_count: 0,
            decks: LookupMap::new(b"d"),
            owned: LookupMap::new(b"o"),
            active_decks: LookupMap::new(b"a"),
            match_count: 0,
            prize_pool: 0,
            matches: LookupMap::new(b"m"),
            ratings: LookupMap::new(b"r"),
            players: Vector::new(b"p"),
        }
    }

    // ---------------------------------------------------------------- oracle

    pub fn set_keeper(&mut self, keeper: AccountId) {
        self.assert_owner();
        self.keeper = keeper;
    }

    /// Keeper only. The first write skips the step cap but still clamps; later writes move a tier by at most 200 bps.
    pub fn set_rates(&mut self, guardian_bps: u16, balanced_bps: u16, degen_bps: u16, source_block: u64) {
        require!(env::predecessor_account_id() == self.keeper, "not keeper");
        let t = now();
        let elapsed = (t - self.cumulative_at) as u128;
        let incoming = [guardian_bps, balanced_bps, degen_bps];
        for i in 0..3 {
            self.cumulative[i] += self.rates[i] as u128 * elapsed;
            self.rates[i] = self.next_rate(self.rates[i], incoming[i]);
        }
        self.cumulative_at = t;
        self.keeper_has_written = true;
        self.last_update = t;
        self.source_block = source_block;
        env::log_str(&format!("RatesSet {} {} {} {}", self.rates[0], self.rates[1], self.rates[2], source_block));
    }

    /// Owner only: set the rates directly (clamped) and re-arm the first-write rule, to recover from a bad write.
    pub fn reset_rates(&mut self, guardian_bps: u16, balanced_bps: u16, degen_bps: u16) {
        self.assert_owner();
        let t = now();
        let elapsed = (t - self.cumulative_at) as u128;
        for i in 0..3 {
            self.cumulative[i] += self.rates[i] as u128 * elapsed;
        }
        self.rates = [guardian_bps.min(MAX_BPS), balanced_bps.min(MAX_BPS), degen_bps.min(MAX_BPS)];
        self.cumulative_at = t;
        self.last_update = t;
        self.keeper_has_written = false;
    }

    /// Keeper only. USD per whole tNEAR with 6 decimals, from the Rhea USDC/wNEAR pool.
    pub fn set_near_price(&mut self, usd_per_near_1e6: U128) {
        require!(env::predecessor_account_id() == self.keeper, "not keeper");
        require!(usd_per_near_1e6.0 > 0, "near price");
        self.near_price = usd_per_near_1e6.0;
    }

    pub fn oracle(&self) -> OracleView {
        OracleView {
            rates_bps: self.rates,
            last_update: U64(self.last_update),
            stale: now() > self.last_update + STALE_AFTER_SECS,
            source_block: U64(self.source_block),
            usd_per_near_1e6: U128(self.near_price),
        }
    }

    // --------------------------------------------------------- token intake

    /// NEP-141 receiver. msg is JSON: {"action":"deposit","tier":0|1|2}, {"action":"reserve"} or {"action":"liquidity"}
    /// (the last two are open donations). Returns the unused amount, always 0.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let asset = self.asset_of(&token);
        let parsed: Msg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("bad msg"));
        match parsed {
            Msg::Deposit { tier } => {
                self.deposit(sender_id, asset, amount.0, tier);
            }
            Msg::Reserve => {
                // Anyone may top up the reserve; donated tokens cannot be withdrawn, only paid out as yield.
                require!(asset == TUSD, "reserve is tUSD");
                self.reserve += amount.0;
            }
            Msg::Liquidity => {
                self.liquidity[asset as usize] += amount.0;
            }
        }
        PromiseOrValue::Value(U128(0))
    }

    // ----------------------------------------------------------------- vault

    /// Owner only: move tUSD from the reserve into a deck's escrow so a demo stake is possible before real yield accrues.
    pub fn seed_escrow(&mut self, deck_id: U64, amount: U128) {
        self.assert_owner();
        let id = deck_id.0;
        let d = self.deck(id);
        require!(!d.retired, "deck");
        self.accrue(id);
        require!(amount.0 <= self.reserve, "reserve");
        self.reserve -= amount.0;
        let mut d = self.deck(id);
        d.escrow += amount.0;
        d.seeded += amount.0;
        self.decks.insert(id, d);
        env::log_str(&format!("EscrowSeeded {} {}", id, amount.0));
    }

    /// Anyone may checkpoint a deck's yield into its escrow.
    pub fn checkpoint(&mut self, deck_id: U64) {
        self.accrue(deck_id.0);
    }

    /// Full withdraw: retires the deck and pays principal plus escrow in `exit_asset` (0 tUSD, 1 tNEAR) at the oracle price.
    pub fn withdraw(&mut self, deck_id: U64, exit_asset: u8, min_out: U128) -> Promise {
        require!(exit_asset <= 1, "asset");
        let id = deck_id.0;
        let d = self.deck(id);
        let caller = env::predecessor_account_id();
        require!(d.owner == caller, "not deck owner");
        require!(!d.retired, "retired");
        require!(d.locked == 0, "stake locked");
        self.accrue(id);
        let mut d = self.deck(id);
        let (p_out, e_out) = self.quote_for(&d, exit_asset);
        let total = p_out + e_out;
        require!(total >= min_out.0, "slippage");

        let (principal, escrow, asset) = (d.principal, d.escrow, d.asset);
        d.retired = true;
        d.principal = 0;
        d.escrow = 0;
        self.decks.insert(id, d);
        self.total_principal[asset as usize] -= principal;
        let a = self.active_decks.get(&caller).copied().unwrap_or(1);
        self.active_decks.insert(caller.clone(), a.saturating_sub(1));
        self.liquidity[asset as usize] += principal;
        self.liquidity[TUSD as usize] += escrow;
        require!(self.liquidity[exit_asset as usize] >= total, "insufficient liquidity");
        self.liquidity[exit_asset as usize] -= total;
        env::log_str(&format!("Withdrawn {} {} {} {}", id, exit_asset, p_out, e_out));
        ext_ft::ext(self.token(exit_asset))
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(caller, U128(total), None)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(Gas::from_tgas(15))
                    .on_withdraw(deck_id, exit_asset, U128(total), U128(principal), U128(escrow)),
            )
    }

    /// If the payout transfer failed, undo the withdraw so the owner keeps the deck, principal and escrow.
    #[private]
    pub fn on_withdraw(&mut self, deck_id: U64, exit_asset: u8, total: U128, principal: U128, escrow: U128, #[callback_result] result: Result<(), PromiseError>) -> bool {
        if result.is_ok() {
            return true;
        }
        self.restore_withdraw(deck_id.0, exit_asset, total.0, principal.0, escrow.0);
        env::log_str(&format!("WithdrawFailed {} restored", deck_id.0));
        false
    }

    pub fn quote_withdraw(&self, deck_id: U64, exit_asset: u8) -> Quote {
        require!(exit_asset <= 1, "asset");
        let mut d = self.deck(deck_id.0);
        d.escrow = self.available_of(&d);
        let (p, e) = self.quote_for(&d, exit_asset);
        Quote { principal_out: U128(p), escrow_out: U128(e) }
    }

    // ----------------------------------------------------------------- arena

    pub fn create_challenge(&mut self, deck_id: U64, opponent: Option<AccountId>) -> U64 {
        let caller = env::predecessor_account_id();
        self.require_owned_active(deck_id.0, &caller);
        require!(opponent.as_ref() != Some(&caller), "self");
        self.match_count += 1;
        let match_id = self.match_count;
        let stake = self.stake_for(deck_id.0);
        let mut m = Match {
            deck_a: deck_id.0,
            deck_b: 0,
            player_a: caller,
            player_b: None,
            opponent,
            stake_a: 0,
            stake_b: 0,
            seed: None,
            status: OPEN,
            created_at: now(),
            seed_block: 0,
            winner: None,
        };
        if self.available_of(&self.deck(deck_id.0)) >= stake {
            m.stake_a = stake;
            self.lock(deck_id.0, stake);
        }
        self.matches.insert(match_id, m);
        env::log_str(&format!("ChallengeCreated {} {}", match_id, deck_id.0));
        U64(match_id)
    }

    pub fn accept(&mut self, match_id: U64, deck_id: U64) {
        let caller = env::predecessor_account_id();
        let mut m = self.match_of(match_id.0);
        require!(m.status == OPEN, "not open");
        require!(now() < m.created_at + CHALLENGE_TTL_SECS, "expired");
        require!(caller != m.player_a, "own challenge");
        require!(m.opponent.is_none() || m.opponent.as_ref() == Some(&caller), "not opponent");
        self.require_owned_active(deck_id.0, &caller);
        require!(!self.deck(m.deck_a).retired, "challenger retired");

        m.deck_b = deck_id.0;
        m.player_b = Some(caller);
        m.status = AWAITING;
        m.seed_block = env::block_height() + 1;

        let stake = self.stake_for(deck_id.0);
        let staked = m.stake_a > 0 && self.available_of(&self.deck(deck_id.0)) >= stake;
        if staked {
            m.stake_b = stake;
            self.lock(deck_id.0, stake);
        } else if m.stake_a > 0 {
            m.stake_a = 0; // either player short means Rank-only
            self.release(m.deck_a);
        }
        self.matches.insert(match_id.0, m);
        env::log_str(&format!("ChallengeAccepted {} {} {}", match_id.0, deck_id.0, staked));
    }

    /// Anyone, once the seed block has passed. The seed mixes the block's random seed with the match, so it is not
    /// known when the players commit. Prototype-only randomness: a caller can choose which block to resolve in.
    pub fn resolve(&mut self, match_id: U64) {
        let mut m = self.match_of(match_id.0);
        require!(m.status == AWAITING, "not awaiting seed");
        require!(env::block_height() > m.seed_block, "seed pending");

        let mut input = Vec::with_capacity(56);
        input.extend_from_slice(&match_id.0.to_be_bytes());
        input.extend_from_slice(&m.deck_a.to_be_bytes());
        input.extend_from_slice(&m.deck_b.to_be_bytes());
        input.extend_from_slice(&env::random_seed());
        let seed: [u8; 32] = env::keccak256_array(&input);
        m.seed = Some(seed);

        let tier_a = self.deck(m.deck_a).tier;
        let tier_b = self.deck(m.deck_b).tier;
        let sim = engine::simulate(seed, tier_a, tier_b);
        let player_b = m.player_b.clone().unwrap_or_else(|| env::panic_str("no opponent"));

        m.status = RESOLVED;
        m.winner = match sim.winner_side {
            0 => Some(m.player_a.clone()),
            1 => Some(player_b.clone()),
            _ => None,
        };
        if m.stake_a > 0 {
            self.settle_stakes(&m, sim.winner_side);
        }
        self.update_ratings(&m.player_a, &player_b, sim.winner_side, match_id.0);
        env::log_str(&format!("MatchResolved {} {} {} {}", match_id.0, sim.rounds, sim.hp_share_a, sim.hp_share_b));
        self.matches.insert(match_id.0, m);
    }

    /// Open challenges only, one hour after creation. Anyone can call.
    pub fn expire(&mut self, match_id: U64) {
        let mut m = self.match_of(match_id.0);
        require!(m.status == OPEN, "not open");
        require!(now() >= m.created_at + CHALLENGE_TTL_SECS, "too early");
        m.status = EXPIRED;
        if m.stake_a > 0 {
            self.release(m.deck_a);
        }
        self.matches.insert(match_id.0, m);
        env::log_str(&format!("MatchExpired {}", match_id.0));
    }

    /// The challenger closes their own open challenge at any time (no need to wait out the hour). Frees the stake.
    pub fn cancel(&mut self, match_id: U64) {
        let mut m = self.match_of(match_id.0);
        require!(m.status == OPEN, "not open");
        require!(env::predecessor_account_id() == m.player_a, "only the challenger can cancel");
        m.status = EXPIRED;
        if m.stake_a > 0 {
            self.release(m.deck_a);
        }
        self.matches.insert(match_id.0, m);
        env::log_str(&format!("MatchCancelled {}", match_id.0));
    }

    // ----------------------------------------------------------------- views

    pub fn config(&self) -> (AccountId, AccountId, AccountId, AccountId) {
        (self.owner.clone(), self.keeper.clone(), self.tusd.clone(), self.tnear.clone())
    }

    pub fn reserve(&self) -> U128 {
        U128(self.reserve)
    }

    pub fn liquidity(&self) -> [U128; 2] {
        [U128(self.liquidity[0]), U128(self.liquidity[1])]
    }

    pub fn prize_pool(&self) -> U128 {
        U128(self.prize_pool)
    }

    pub fn deck_count(&self) -> U64 {
        U64(self.deck_count)
    }

    pub fn match_count(&self) -> U64 {
        U64(self.match_count)
    }

    pub fn stake_of_deck(&self, deck_id: U64) -> U128 {
        U128(self.stake_for(deck_id.0))
    }

    pub fn get_deck(&self, deck_id: U64) -> Option<DeckView> {
        self.decks.get(&deck_id.0).map(|d| self.deck_view(deck_id.0, d))
    }

    /// Includes retired decks; filter on `retired`.
    pub fn decks_of(&self, account_id: AccountId) -> Vec<DeckView> {
        self.owned
            .get(&account_id)
            .map(|ids| ids.iter().filter_map(|id| self.decks.get(id).map(|d| self.deck_view(*id, d))).collect())
            .unwrap_or_default()
    }

    /// The deck's onchain SVG card.
    pub fn deck_svg(&self, deck_id: U64) -> String {
        let d = self.deck(deck_id.0);
        svg::render(deck_id.0, d.tier, d.asset == TNEAR, d.retired)
    }

    pub fn get_match(&self, match_id: U64) -> Option<MatchView> {
        self.matches.get(&match_id.0).map(|m| Self::match_view(match_id.0, m))
    }

    /// Newest first, so the app can scan for open challenges in one call.
    pub fn recent_matches(&self, limit: u32) -> Vec<MatchView> {
        let mut out = Vec::new();
        let mut id = self.match_count;
        while id > 0 && (out.len() as u32) < limit.min(100) {
            if let Some(m) = self.matches.get(&id) {
                out.push(Self::match_view(id, m));
            }
            id -= 1;
        }
        out
    }

    pub fn rating_of(&self, account_id: AccountId) -> u32 {
        self.ratings.get(&account_id).copied().unwrap_or(START_RATING)
    }

    pub fn player_count(&self) -> u32 {
        self.players.len()
    }

    /// Every player who has finished a match, with their Elo, in the order they first played.
    pub fn players(&self, from_index: u32, limit: u32) -> Vec<PlayerView> {
        (from_index..self.players.len().min(from_index.saturating_add(limit.min(200))))
            .map(|i| {
                let account = self.players.get(i).unwrap().clone();
                let rating = self.rating_of(account.clone());
                PlayerView { account, rating }
            })
            .collect()
    }

    /// The contract's own battle result, for the replay check. Seed is the 64-hex-character match seed.
    pub fn simulate(&self, seed: String, tier_a: u8, tier_b: u8) -> SimView {
        let r = engine::simulate(parse_seed(&seed), tier_a, tier_b);
        SimView { winner_side: r.winner_side, rounds: r.rounds, hp_share_a: r.hp_share_a, hp_share_b: r.hp_share_b }
    }

    /// The full action log the app animates. Same rolls as `simulate`.
    pub fn simulate_with_log(&self, seed: String, tier_a: u8, tier_b: u8) -> Vec<engine::Action> {
        engine::simulate_with_log(parse_seed(&seed), tier_a, tier_b)
    }
}

// ------------------------------------------------------------------ internals

impl Game {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
    }

    fn asset_of(&self, token: &AccountId) -> u8 {
        if *token == self.tusd {
            TUSD
        } else if *token == self.tnear {
            TNEAR
        } else {
            env::panic_str("unknown token")
        }
    }

    fn token(&self, asset: u8) -> AccountId {
        if asset == TUSD { self.tusd.clone() } else { self.tnear.clone() }
    }

    fn next_rate(&self, current: u16, incoming: u16) -> u16 {
        let target = incoming.min(MAX_BPS);
        if !self.keeper_has_written {
            return target;
        }
        if target > current + STEP_BPS {
            return current + STEP_BPS;
        }
        if current > STEP_BPS && target < current - STEP_BPS {
            return current - STEP_BPS;
        }
        target
    }

    fn cum(&self, tier: u8) -> u128 {
        let i = tier as usize;
        self.cumulative[i] + self.rates[i] as u128 * (now() - self.cumulative_at) as u128
    }

    fn deck(&self, id: u64) -> Deck {
        self.decks.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such deck"))
    }

    fn match_of(&self, id: u64) -> Match {
        self.matches.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such match"))
    }

    fn usd_value(&self, asset: u8, amount: u128) -> u128 {
        if asset == TUSD { amount } else { amount * self.near_price / NEAR_UNIT }
    }

    fn deposit(&mut self, sender: AccountId, asset: u8, amount: u128, tier: u8) {
        require!(tier < 3, "tier");
        let active = self.active_decks.get(&sender).copied().unwrap_or(0);
        require!(active < MAX_DECKS, "max decks");
        let value = self.usd_value(asset, amount);
        require!(value >= MIN_DEPOSIT_USD, "below minimum");

        self.deck_count += 1;
        let id = self.deck_count;
        let deck = Deck {
            owner: sender.clone(),
            tier,
            asset,
            principal: amount,
            deposit_value_usd: value,
            deposited_at: now(),
            retired: false,
            escrow: 0,
            locked: 0,
            seeded: 0,
            last_cum: self.cum(tier),
        };
        self.decks.insert(id, deck);
        let mut ids = self.owned.get(&sender).cloned().unwrap_or_default();
        ids.push(id);
        self.owned.insert(sender.clone(), ids);
        self.active_decks.insert(sender.clone(), active + 1);
        self.total_principal[asset as usize] += amount;
        env::log_str(&format!("DeckMinted {} {} {} {} {}", id, sender, tier, asset, amount));
    }

    fn restore_withdraw(&mut self, id: u64, exit_asset: u8, total: u128, principal: u128, escrow: u128) {
        let mut d = self.deck(id);
        require!(d.retired, "not retired");
        let asset = d.asset;
        self.liquidity[exit_asset as usize] += total;
        self.liquidity[TUSD as usize] -= escrow;
        self.liquidity[asset as usize] -= principal;
        self.total_principal[asset as usize] += principal;
        d.retired = false;
        d.principal = principal;
        d.escrow = escrow;
        d.last_cum = self.cum(d.tier); // no yield is credited for the time the withdraw was in flight
        let owner = d.owner.clone();
        self.decks.insert(id, d);
        let a = self.active_decks.get(&owner).copied().unwrap_or(0);
        self.active_decks.insert(owner, a + 1);
    }

    fn pending_of(&self, d: &Deck) -> u128 {
        d.deposit_value_usd * (self.cum(d.tier) - d.last_cum) / YEAR_BPS
    }

    /// Escrow plus yield not yet checkpointed, limited by what the reserve can pay.
    fn available_of(&self, d: &Deck) -> u128 {
        if d.retired {
            return d.escrow;
        }
        d.escrow + self.pending_of(d).min(self.reserve)
    }

    fn accrue(&mut self, id: u64) {
        let mut d = self.deck(id);
        if d.retired {
            return;
        }
        let pending = self.pending_of(&d);
        d.last_cum = self.cum(d.tier);
        let paid = pending.min(self.reserve);
        if paid < pending {
            env::log_str(&format!("ReserveShort {} {}", id, pending - paid));
        }
        self.reserve -= paid;
        d.escrow += paid;
        self.decks.insert(id, d);
    }

    fn stake_for(&self, id: u64) -> u128 {
        self.deck(id).deposit_value_usd / 1000
    }

    fn lock(&mut self, id: u64, amount: u128) {
        self.accrue(id);
        let mut d = self.deck(id);
        require!(d.locked == 0, "stake active");
        d.escrow -= amount;
        d.locked = amount;
        self.decks.insert(id, d);
    }

    fn release(&mut self, id: u64) {
        let mut d = self.deck(id);
        d.escrow += d.locked;
        d.locked = 0;
        self.decks.insert(id, d);
    }

    fn require_owned_active(&self, id: u64, caller: &AccountId) {
        let d = self.deck(id);
        require!(d.owner == *caller, "not deck owner");
        require!(!d.retired, "retired");
        require!(d.locked == 0, "stake active");
    }

    /// Withdraw amounts in `exit` units: principal converted at the oracle price, escrow is tUSD converted likewise.
    fn quote_for(&self, d: &Deck, exit: u8) -> (u128, u128) {
        let p = if d.asset == exit {
            d.principal
        } else if exit == TUSD {
            d.principal * self.near_price / NEAR_UNIT
        } else {
            d.principal * NEAR_UNIT / self.near_price
        };
        let e = if exit == TUSD { d.escrow } else { d.escrow * NEAR_UNIT / self.near_price };
        (p, e)
    }

    /// Winner keeps their own stake and gets 95% of the loser's; 5% goes to the prize pool.
    fn settle_stakes(&mut self, m: &Match, side: u8) {
        if side == 2 {
            self.release(m.deck_a);
            self.release(m.deck_b);
            return;
        }
        let (won, lost_deck) = if side == 0 { (m.deck_a, m.deck_b) } else { (m.deck_b, m.deck_a) };
        let mut w = self.deck(won);
        let mut l = self.deck(lost_deck);
        let own = w.locked;
        let lost = l.locked;
        w.locked = 0;
        l.locked = 0;
        let prize = lost * 5 / 100;
        w.escrow += own + lost - prize;
        self.prize_pool += prize;
        self.decks.insert(won, w);
        self.decks.insert(lost_deck, l);
    }

    fn update_ratings(&mut self, a: &AccountId, b: &AccountId, side: u8, match_id: u64) {
        let (old_a, old_b) = (self.rating_of(a.clone()), self.rating_of(b.clone()));
        let score_a: i128 = match side {
            0 => 1_000_000,
            1 => 0,
            _ => 500_000,
        };
        let new_a = elo::next(old_a, old_b, score_a);
        let new_b = elo::next(old_b, old_a, 1_000_000 - score_a);
        for (who, new) in [(a, new_a), (b, new_b)] {
            if self.ratings.get(who).is_none() {
                self.players.push(who.clone());
            }
            self.ratings.insert(who.clone(), new);
        }
        env::log_str(&format!("RatingChanged {} {} {} {}", a, match_id, old_a, new_a));
        env::log_str(&format!("RatingChanged {} {} {} {}", b, match_id, old_b, new_b));
    }

    fn deck_view(&self, id: u64, d: &Deck) -> DeckView {
        DeckView {
            id: U64(id),
            owner: d.owner.clone(),
            tier: d.tier,
            asset: d.asset,
            principal: U128(d.principal),
            deposit_value_usd: U128(d.deposit_value_usd),
            deposited_at: U64(d.deposited_at),
            retired: d.retired,
            available: U128(self.available_of(d)),
            locked: U128(d.locked),
            seeded: U128(d.seeded),
        }
    }

    fn match_view(id: u64, m: &Match) -> MatchView {
        MatchView {
            id: U64(id),
            deck_a: U64(m.deck_a),
            deck_b: U64(m.deck_b),
            player_a: m.player_a.clone(),
            player_b: m.player_b.clone(),
            opponent: m.opponent.clone(),
            stake_a: U128(m.stake_a),
            stake_b: U128(m.stake_b),
            seed: m.seed.map(|s| s.iter().map(|b| format!("{b:02x}")).collect()),
            status: m.status,
            created_at: U64(m.created_at),
            seed_block: U64(m.seed_block),
            winner: m.winner.clone(),
        }
    }
}

fn parse_seed(s: &str) -> [u8; 32] {
    let s = s.strip_prefix("0x").unwrap_or(s);
    require!(s.len() == 64, "seed must be 64 hex characters");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap_or_else(|_| env::panic_str("bad seed"));
    }
    out
}

#[cfg(test)]
mod tests;

#[cfg(test)]
impl Game {
    /// Test helper: the exit-in-tNEAR total the withdraw above paid out.
    fn quote_withdraw_total_for_test(&self, principal: u128, escrow: u128) -> u128 {
        (principal + escrow) * NEAR_UNIT / self.near_price
    }
}
