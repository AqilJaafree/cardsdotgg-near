//! Cardsdotgg on NEAR: one contract holding the rate oracle, deck vault, yield escrow and arena.
//!
//! This replaces the Monad contracts (RateOracle, DeckVault, DeckNFT, YieldEscrow, Arena, BattleEngine, WithdrawRouter).
//! NEAR calls between contracts are asynchronous, so everything that has to change together lives here and settles in
//! one transaction. Tokens are NEP-141: deposits arrive through `ft_on_transfer`, payouts leave through `ft_transfer`.
//!
//! Accounting invariant for tUSD held by this contract:
//!   balance = reserve + liquidity[0] + total_principal[0] + prize_pool + sum(deck escrow) + sum(deck locked)
pub mod card_data;
pub mod collection;
pub mod duel;
pub mod elo;
pub mod engine;
pub mod nft;
pub mod rwa;
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
    /// Legacy paid trial pack. Trial packs are free now (`open_pack`): this still opens one, and returns all the tUSD sent.
    Pack,
    /// Buy one season pack (same price): one tokenized physical card, only while the season is open and cards are left.
    SeasonPack,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RwaStockView {
    pub total: u8,
    pub remaining: u8,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct RwaTokenView {
    pub id: u8,
    /// What the token stands for, e.g. "SV11W 011 Tepig".
    pub card: String,
    /// None while the card is still in the pack stock.
    pub owner: Option<AccountId>,
    pub minted_at: Option<u64>,
    pub redeemed: bool,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct SeasonView {
    pub name: String,
    /// Unix seconds.
    pub start: u64,
    pub end: u64,
    pub now: u64,
    pub open: bool,
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
const PLAYING: u8 = 2; // turn-based duel in progress
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

/// A deck's chosen cards and art. `custom` is false for a deck still on its tier's starter cards.
#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DeckCardsView {
    pub cards: Vec<u8>,
    pub art: Vec<u8>,
    pub custom: bool,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct DeckCards {
    cards: [u8; 8],
    art: [u8; 8],
    /// Max-HP perk per slot, worked out from the owner's unlocked pictures when the deck was saved.
    perk: [u8; 8],
}

/// The record as the first version of custom decks stored it (prefix "c"). Still read, never written, so decks saved
/// before packs existed keep working with no perks.
#[near(serializers = [borsh])]
#[derive(Clone)]
struct DeckCardsV1 {
    cards: [u8; 8],
    art: [u8; 8],
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct CollectionView {
    pub creatures: Vec<u8>,
    pub pictures: Vec<u8>,
    pub opened: u32,
    pub last_pack: Option<collection::Pack>,
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
            Msg::Pack => {
                self.open_trial_pack(&sender_id);
                return PromiseOrValue::Value(amount); // free now: everything sent comes back
            }
            Msg::SeasonPack => {
                require!(asset == TUSD, "packs cost tUSD");
                let season = Self::season_of().unwrap_or_else(|| env::panic_str("no season is set"));
                require!(season.is_open(now()), "the season pack is not open");
                require!(amount.0 >= collection::PACK_PRICE, "a pack costs 2 tUSD");
                let mut stock = Self::rwa_stock_of();
                require!(stock.remaining() > 0, "the season pack is sold out");
                // The season pack holds exactly one physical card from the stock, minted to the buyer as a one-of-one
                // token. Nothing else: no pictures, no creature.
                let mut input = Vec::with_capacity(80);
                input.extend_from_slice(b"season");
                input.extend_from_slice(sender_id.as_bytes());
                input.extend_from_slice(&[stock.remaining()]);
                input.extend_from_slice(&env::random_seed());
                let seed = env::keccak256_array(&input);
                let token_id = stock.draw(&seed).unwrap();
                Self::rwa_stock_put(&stock);
                let mut tokens = Self::rwa_tokens();
                tokens.insert(token_id, rwa::Token { owner: sender_id.clone(), minted_at: now(), redeemed: false });
                tokens.flush();
                self.prize_pool += collection::PACK_PRICE;
                env::log_str(&format!("SeasonPackOpened {} rwa:{}", sender_id, token_id));
                nft::emit("nft_mint", near_sdk::serde_json::json!({ "owner_id": sender_id, "token_ids": [token_id.to_string()] }));
                return PromiseOrValue::Value(U128(amount.0 - collection::PACK_PRICE));
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
        let mut m = self.join_challenge(match_id.0, deck_id.0);
        m.status = AWAITING;
        m.seed_block = env::block_height() + 1;
        self.matches.insert(match_id.0, m);
    }

    /// Accept a challenge as a turn-based duel: players alternate onchain moves (`play`) instead of an auto-battle.
    pub fn accept_duel(&mut self, match_id: U64, deck_id: U64) {
        let mut m = self.join_challenge(match_id.0, deck_id.0);
        m.status = PLAYING;
        // SPD decides who moves first; the block's random seed only breaks ties.
        let seed = self.duel_seed(match_id.0, 0);
        let d = duel::Duel::with_decks(&self.setup_of(m.deck_a), &self.setup_of(m.deck_b), seed, now());
        let first = d.mover;
        self.duel_put(match_id.0, &d);
        self.matches.insert(match_id.0, m);
        env::log_str(&format!("DuelStarted {} {}", match_id.0, first));
    }

    /// One move by the player whose turn it is. `action`: 0 attach energy, 1 attack, 2 power attack, 3 retreat to bench
    /// slot `arg` (costs 1 energy). An attack ends the turn. Reaching 3 points ends the match and pays out right here.
    pub fn play(&mut self, match_id: U64, action: u8, arg: u8) {
        self.play_turn(match_id, vec![(action, arg)]);
    }

    /// A whole turn in one transaction (one signature): moves are applied in order, for example attach, retreat, attack.
    /// All or nothing: if any move is illegal the whole call reverts. Moves after the match ends are rejected.
    pub fn play_turn(&mut self, match_id: U64, moves: Vec<(u8, u8)>) {
        let caller = env::predecessor_account_id();
        let m = self.match_of(match_id.0);
        require!(m.status == PLAYING, "not a live duel");
        require!(!moves.is_empty() && moves.len() <= 4, "1 to 4 moves");
        let mut d = self.duel_of(match_id.0);
        let side = self.side_of(&m, &caller);
        require!(d.mover == side, "not your turn");
        for (action, arg) in moves {
            require!(d.mover == side && d.winner.is_none(), "turn is over");
            let act = duel::Action::parse(action, arg).unwrap_or_else(|| env::panic_str("unknown action"));
            // Rolls come from the block this move lands in, so the mover cannot know them when choosing.
            let seed = self.duel_seed(match_id.0, d.log.len() as u64);
            if let Err(e) = d.play(act, now(), seed) {
                env::panic_str(e.message());
            }
            let last = d.log.last().cloned().unwrap();
            env::log_str(&format!("DuelMove {} {} {} {} {} {} {}", match_id.0, side, last.action, last.arg, last.damage, last.crit, last.ko));
        }
        self.after_duel_move(match_id.0, m, d);
    }

    /// A player gives up. The other player wins and the stakes settle as usual.
    pub fn forfeit(&mut self, match_id: U64) {
        let caller = env::predecessor_account_id();
        let m = self.match_of(match_id.0);
        require!(m.status == PLAYING, "not a live duel");
        let mut d = self.duel_of(match_id.0);
        let side = self.side_of(&m, &caller);
        d.concede(side, now());
        env::log_str(&format!("DuelForfeit {} {}", match_id.0, side));
        self.after_duel_move(match_id.0, m, d);
    }

    /// Anyone, once the player to move has been silent for `duel::TURN_SECS`: the player who is waiting wins.
    pub fn claim_timeout(&mut self, match_id: U64) {
        let m = self.match_of(match_id.0);
        require!(m.status == PLAYING, "not a live duel");
        let mut d = self.duel_of(match_id.0);
        require!(now() >= d.last_move_at + duel::TURN_SECS, "still their turn");
        let slow = d.mover;
        d.concede(slow, now());
        env::log_str(&format!("DuelTimeout {} {}", match_id.0, slow));
        self.after_duel_move(match_id.0, m, d);
    }

    /// Pick the deck's 8 creatures (the first leads, the next 3 start on the bench, the last 4 in hand) and an art skin
    /// for each (0 = default face, 1..=102 = a card image, 103..=126 = a season picture). Only the owner, and not while coins are staked.
    pub fn set_deck_cards(&mut self, deck_id: U64, cards: Vec<u8>, art: Vec<u8>) {
        let caller = env::predecessor_account_id();
        self.require_owned_active(deck_id.0, &caller);
        if let Err(e) = duel::check_deck(&cards, &art) {
            env::panic_str(e);
        }
        let col = self.collection_of(&caller);
        if let Err(e) = collection::check_ownership(&col, self.deck(deck_id.0).tier, &cards, &art) {
            env::panic_str(e);
        }
        let perk = collection::perks(&col, &art);
        let mut map = Self::deck_cards();
        map.insert(deck_id.0, DeckCards { cards: cards.clone().try_into().unwrap(), art: art.try_into().unwrap(), perk });
        map.flush();
        env::log_str(&format!("DeckCustomized {} {:?}", deck_id.0, cards));
    }

    /// The deck's current cards and art; the tier's starter cards with default art until customized.
    pub fn get_deck_cards(&self, deck_id: U64) -> DeckCardsView {
        let setup = self.setup_of(deck_id.0);
        DeckCardsView { cards: setup.lineup.to_vec(), art: setup.art.to_vec(), custom: Self::saved_deck_cards(deck_id.0).is_some() }
    }

    /// What an account has unlocked: creatures and pictures, how many packs it opened, and its latest pack.
    /// The starter creatures and pictures of a deck are always usable and are not listed here.
    pub fn get_collection(&self, account_id: AccountId) -> CollectionView {
        let c = self.collection_of(&account_id);
        CollectionView { creatures: c.creature_list(), pictures: c.picture_list(), opened: c.opened, last_pack: c.last.clone() }
    }

    /// Open one trial pack (Guardian, Balanced or Degen art), free for every account: 5 trial pictures and 1 creature.
    /// Only gas is paid. Season packs, which hold real physical cards, still cost tUSD.
    pub fn open_pack(&mut self) -> collection::Pack {
        self.open_trial_pack(&env::predecessor_account_id())
    }

    /// Price of one trial pack in tUSD base units: 0, trial packs are free.
    pub fn pack_price(&self) -> U128 {
        U128(0)
    }

    /// Price of one season pack (one tokenized physical card) in tUSD base units (6 decimals).
    pub fn season_pack_price(&self) -> U128 {
        U128(collection::PACK_PRICE)
    }

    /// Owner only: set the limited-time season (unix seconds). The season pack sells only while start <= now < end.
    pub fn set_season(&mut self, name: String, start: U64, end: U64) {
        self.assert_owner();
        require!(end.0 > start.0, "the season must end after it starts");
        require!(!name.is_empty() && name.len() <= 40, "season name is 1 to 40 characters");
        let mut map = Self::seasons();
        map.insert(0, collection::Season { name: name.clone(), start: start.0, end: end.0 });
        map.flush();
        env::log_str(&format!("SeasonSet {} {} {}", name, start.0, end.0));
    }

    /// Owner only: load the physical cards behind the season pack, one entry per card held (token id = index).
    /// Allowed only while none has been pulled, so a minted token always points at the card it was sold as.
    pub fn set_rwa_stock(&mut self, cards: Vec<String>) {
        self.assert_owner();
        require!(!cards.is_empty() && cards.len() <= rwa::MAX_CARDS, "1 to 32 cards");
        require!(cards.iter().all(|c| !c.is_empty() && c.len() <= 64), "each card is 1 to 64 characters");
        require!(Self::rwa_stock_of().sold == 0, "cards have already been pulled");
        Self::rwa_stock_put(&rwa::Stock { cards: cards.clone(), sold: 0 });
        env::log_str(&format!("RwaStockSet {}", cards.len()));
    }

    /// How many physical cards the season pack holds and how many are left.
    pub fn rwa_stock(&self) -> RwaStockView {
        let s = Self::rwa_stock_of();
        RwaStockView { total: s.total(), remaining: s.remaining() }
    }

    /// Every token, minted or still in stock, in id order.
    pub fn rwa_all(&self) -> Vec<RwaTokenView> {
        let s = Self::rwa_stock_of();
        (0..s.total()).map(|i| Self::rwa_view(&s, i)).collect()
    }

    /// The tokens an account holds (redeemed ones included, marked as such).
    pub fn rwa_tokens_of(&self, account_id: AccountId) -> Vec<RwaTokenView> {
        self.rwa_all().into_iter().filter(|t| t.owner.as_ref() == Some(&account_id)).collect()
    }

    /// Holder only: ask for the physical card. The token is marked redeemed for good; shipping is arranged off-chain.
    pub fn rwa_redeem(&mut self, token_id: u8) {
        let caller = env::predecessor_account_id();
        let mut tokens = Self::rwa_tokens();
        let mut t = tokens.get(&token_id).cloned().unwrap_or_else(|| env::panic_str("no such token"));
        require!(t.owner == caller, "not the token holder");
        require!(!t.redeemed, "already redeemed");
        t.redeemed = true;
        tokens.insert(token_id, t);
        tokens.flush();
        Self::approvals_put(token_id, &nft::Approvals { next_id: Self::approvals_of(token_id).next_id, accounts: vec![] });
        env::log_str(&format!("RwaRedeemRequested {} {}", token_id, caller));
        nft::emit("nft_burn", near_sdk::serde_json::json!({ "owner_id": caller, "token_ids": [token_id.to_string()] }));
    }

    /// The current season, if one is set, and whether its pack is open right now.
    pub fn get_season(&self) -> Option<SeasonView> {
        Self::season_of().map(|s| SeasonView { open: s.is_open(now()), now: now(), name: s.name, start: s.start, end: s.end })
    }

    /// Open duel state, move log included. None for matches that were not accepted as duels.
    pub fn get_duel(&self, match_id: U64) -> Option<duel::Duel> {
        Self::find_duel(match_id.0)
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

    /// The shared half of accepting a challenge: validates, locks stakes, records the opponent.
    fn join_challenge(&mut self, match_id: u64, deck_id: u64) -> Match {
        let caller = env::predecessor_account_id();
        let mut m = self.match_of(match_id);
        require!(m.status == OPEN, "not open");
        require!(now() < m.created_at + CHALLENGE_TTL_SECS, "expired");
        require!(caller != m.player_a, "own challenge");
        require!(m.opponent.is_none() || m.opponent.as_ref() == Some(&caller), "not opponent");
        self.require_owned_active(deck_id, &caller);
        require!(!self.deck(m.deck_a).retired, "challenger retired");

        m.deck_b = deck_id;
        m.player_b = Some(caller);

        let stake = self.stake_for(deck_id);
        let staked = m.stake_a > 0 && self.available_of(&self.deck(deck_id)) >= stake;
        if staked {
            m.stake_b = stake;
            self.lock(deck_id, stake);
        } else if m.stake_a > 0 {
            m.stake_a = 0; // either player short means Rank-only
            self.release(m.deck_a);
        }
        env::log_str(&format!("ChallengeAccepted {} {} {}", match_id, deck_id, staked));
        m
    }

    /// Duels (with picture perks) live in their own map under prefix "w".
    fn duels() -> LookupMap<u64, duel::Duel> {
        LookupMap::new(b"w")
    }

    /// Duels stored before picture perks existed (prefix "u"). They are still read, and moved to the new map on their next move.
    fn duels_v1() -> LookupMap<u64, duel::DuelV1> {
        LookupMap::new(b"u")
    }

    fn find_duel(id: u64) -> Option<duel::Duel> {
        Self::duels().get(&id).cloned().or_else(|| Self::duels_v1().get(&id).cloned().map(Into::into))
    }

    /// Per-move randomness: the block's random seed mixed with the match and how many moves came before.
    fn duel_seed(&self, id: u64, n: u64) -> [u8; 32] {
        let mut input = Vec::with_capacity(48);
        input.extend_from_slice(&id.to_be_bytes());
        input.extend_from_slice(&n.to_be_bytes());
        input.extend_from_slice(&env::random_seed());
        env::keccak256_array(&input)
    }

    /// Collections live in their own map under prefix "k", for the same no-migration reason as duels.
    fn collections() -> LookupMap<AccountId, collection::Collection> {
        LookupMap::new(b"k")
    }

    fn collection_of(&self, who: &AccountId) -> collection::Collection {
        Self::collections().get(who).cloned().unwrap_or_default()
    }

    fn collection_put(&self, who: &AccountId, c: &collection::Collection) {
        let mut map = Self::collections();
        map.insert(who.clone(), c.clone());
        map.flush();
    }

    /// Draw a trial pack for `who` and add it to their collection.
    fn open_trial_pack(&mut self, who: &AccountId) -> collection::Pack {
        let mut col = self.collection_of(who);
        let mut input = Vec::with_capacity(72);
        input.extend_from_slice(who.as_bytes());
        input.extend_from_slice(&col.opened.to_be_bytes());
        input.extend_from_slice(&env::random_seed());
        let pack = collection::open(env::keccak256_array(&input));
        col.add(&pack);
        self.collection_put(who, &col);
        env::log_str(&format!("PackOpened {} {:?} {}", who, pack.pictures, pack.creature));
        pack
    }

    /// The physical-card stock lives under prefix "x" (key 0), minted tokens under prefix "y" (token id).
    fn rwa_stock_of() -> rwa::Stock {
        LookupMap::<u8, rwa::Stock>::new(b"x").get(&0).cloned().unwrap_or_default()
    }

    fn rwa_stock_put(s: &rwa::Stock) {
        let mut map = LookupMap::<u8, rwa::Stock>::new(b"x");
        map.insert(0, s.clone());
        map.flush();
    }

    fn rwa_tokens() -> LookupMap<u8, rwa::Token> {
        LookupMap::new(b"y")
    }

    fn rwa_view(s: &rwa::Stock, id: u8) -> RwaTokenView {
        let t = Self::rwa_tokens().get(&id).cloned();
        RwaTokenView {
            id,
            card: s.cards[id as usize].clone(),
            owner: t.as_ref().map(|t| t.owner.clone()),
            minted_at: t.as_ref().map(|t| t.minted_at),
            redeemed: t.map_or(false, |t| t.redeemed),
        }
    }

    /// The season lives in its own map under prefix "s" (key 0), so adding it needed no state migration.
    fn seasons() -> LookupMap<u8, collection::Season> {
        LookupMap::new(b"s")
    }

    fn season_of() -> Option<collection::Season> {
        Self::seasons().get(&0).cloned()
    }

    /// Custom deck cards (with perks) live in their own map under prefix "e", for the same no-migration reason as duels.
    fn deck_cards() -> LookupMap<u64, DeckCards> {
        LookupMap::new(b"e")
    }

    /// Decks customized before packs existed (prefix "c").
    fn deck_cards_v1() -> LookupMap<u64, DeckCardsV1> {
        LookupMap::new(b"c")
    }

    fn saved_deck_cards(deck_id: u64) -> Option<DeckCards> {
        Self::deck_cards().get(&deck_id).cloned().or_else(|| Self::deck_cards_v1().get(&deck_id).map(|o| DeckCards { cards: o.cards, art: o.art, perk: [0; 8] }))
    }

    /// The deck as a duel brings it: custom cards and art if set, else the tier's starter cards.
    fn setup_of(&self, deck_id: u64) -> duel::Setup {
        let tier = self.deck(deck_id).tier;
        match Self::saved_deck_cards(deck_id) {
            Some(c) => duel::Setup { lineup: c.cards, art: c.art, perk: c.perk, tier },
            None => duel::Setup::tier(tier),
        }
    }

    fn duel_of(&self, id: u64) -> duel::Duel {
        Self::find_duel(id).unwrap_or_else(|| env::panic_str("no such duel"))
    }

    fn duel_put(&self, id: u64, d: &duel::Duel) {
        let mut map = Self::duels();
        map.insert(id, d.clone());
        map.flush();
    }

    fn side_of(&self, m: &Match, who: &AccountId) -> u8 {
        if *who == m.player_a {
            0
        } else if m.player_b.as_ref() == Some(who) {
            1
        } else {
            env::panic_str("not a player in this match")
        }
    }

    /// Store the duel; if someone just won, close the match: winner, stakes, ratings.
    fn after_duel_move(&mut self, id: u64, mut m: Match, d: duel::Duel) {
        self.duel_put(id, &d);
        let Some(side) = d.winner else { return };
        let player_b = m.player_b.clone().unwrap_or_else(|| env::panic_str("no opponent"));
        m.status = RESOLVED;
        m.winner = match side {
            0 => Some(m.player_a.clone()),
            1 => Some(player_b.clone()),
            _ => None, // draw
        };
        if m.stake_a > 0 {
            self.settle_stakes(&m, side);
        }
        self.update_ratings(&m.player_a, &player_b, side, id);
        env::log_str(&format!("DuelFinished {} {} {} {}", id, side, d.sides[0].points, d.sides[1].points));
        self.matches.insert(id, m);
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
