//! Turn-based duel on the spec's 24 creatures (cardsdotgg.md "Battle engine" + shared/engine-rules.md), played by two
//! players one onchain move at a time. Pure and deterministic given the seed handed to `play`, so it unit-tests natively.
//!
//! Turn skeleton (borrowed from the Pokémon TCG): alternate turns; one Energy attach per turn; one Retreat per turn,
//! discarding Energy equal to the retreat cost; an attack ends the turn; every knockout is a point; first to 3 wins.
//! Board: 8 cards per side = 1 active, 3 on the bench, 4 in hand. A knockout promotes the first bench card and the
//! bench refills from the hand.
//!
//! Damage (spec order, integer math): base = ATK*1000/(50+DEF); then Energy (+15% per Energy) and Power attack (x1.6);
//! class wheel (x1.25 / x0.8); variance 90..110%; crit by tier; attacker abilities; defender abilities; min 1.
//! Differences from the auto-battle, all because there is one active card and players alternate:
//! - Spec "rounds" become each player's own turns: start-of-round effects happen at the start of your turn,
//!   end-of-round effects at the end of your turn.
//! - Peg Shield recharges over 3 of its owner's turns instead of every round.
//! - SPD only decides who moves first (Ape Comet always does, Basis Kestrel borrows the higher enemy SPD).
//! - The class wheel and the Energy / Power / Retreat numbers are new and need playtesting.
use crate::card_data;
use near_sdk::near;
use sha3::{Digest, Keccak256};

pub const WIN_POINTS: u8 = 3;
pub const MAX_ENERGY: u8 = 5;
pub const POWER_COST: u8 = 3;
pub const RETREAT_COST: u8 = 1;
pub const TURN_SECS: u64 = 300;
const ENERGY_BPS: u64 = 1500; // +15% damage per Energy on the attacker
const POWER_PCT: u64 = 160;
const ADVANTAGE_PCT: u64 = 125;
const DISADVANTAGE_PCT: u64 = 80;
/// Peg Shield blocks one hit, then recharges over the owner's next 3 turns (one block per three enemy turns, like
/// the spec's "first hit each round" against three attackers).
const SHIELD_RECHARGE: u8 = 3;

// card ids (same as engine.rs)
const PEGSHELL: u8 = 0;
const SENTINEL: u8 = 1;
const TORTOISE: u8 = 2;
const OWL: u8 = 3;
const GOLEM: u8 = 4;
const SPRITE: u8 = 5;
const CRAB: u8 = 6;
const BISON: u8 = 7;
const LYNX: u8 = 8;
const HERON: u8 = 9;
const RAM: u8 = 10;
const FOX: u8 = 11;
const BEAR: u8 = 12;
const BEETLE: u8 = 13;
const KESTREL: u8 = 14;
const SERPENT: u8 = 15;
const RAPTOR: u8 = 16;
const WOLF: u8 = 17;
const WASP: u8 = 18;
const KRAKEN: u8 = 19;
const PANTHER: u8 = 20;
const COMET: u8 = 21;
const MANTIS: u8 = 22;
const HYDRA: u8 = 23;

/// The three 8-card lineups, one per deck tier: the tier's own cards in order. Index 0 starts active, 1-3 start on the
/// bench, 4-7 start in hand.
pub fn lineup(tier: u8) -> [u8; 8] {
    let base = (tier % 3) * 8;
    [base, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7]
}

/// Crit chance (bps) and multiplier (percent) from the risk tier table.
fn crit(tier: u8) -> (u64, u64) {
    match tier {
        0 => (500, 130),
        1 => (1200, 150),
        _ => (2500, 180),
    }
}

fn class_index(id: u8) -> u8 {
    match card_data::CLASSES[id as usize] {
        "Stable" => 0,
        "Treasury" => 1,
        "Gold" => 2,
        "Credit" => 3,
        _ => 4, // BTC
    }
}

/// Class wheel: each class is strong against the next one (Stable > Treasury > Gold > Credit > BTC > Stable).
pub fn class_pct(attacker: u8, defender: u8) -> u64 {
    let (a, d) = (class_index(attacker), class_index(defender));
    if (a + 1) % 5 == d {
        ADVANTAGE_PCT
    } else if (d + 1) % 5 == a {
        DISADVANTAGE_PCT
    } else {
        100
    }
}

/// One card with its live state. `used` is the card's single once-per-match ability flag; `shield_cd` is Peg Shield's recharge.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Card {
    pub id: u8,
    pub hp: u32,
    pub max_hp: u32,
    pub energy: u8,
    pub atk_bonus: u32,
    pub crit_bonus: u32,
    pub widen: u8,
    pub halved: bool,
    pub used: bool,
    pub shield_cd: u8,
}

/// A card with a max-HP bonus of `perk` percent.
pub fn card_perk(id: u8, perk: u8) -> Card {
    let mut c = card(id);
    c.max_hp = c.max_hp * (100 + perk as u32) / 100;
    c.hp = c.max_hp;
    c
}

pub fn card(id: u8) -> Card {
    let (hp, _, _, _) = card_data::stats(id);
    let max_hp = hp as u32 * 50;
    Card { id, hp: max_hp, max_hp, energy: 0, atk_bonus: 0, crit_bonus: 0, widen: 0, halved: false, used: false, shield_cd: 0 }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Side {
    pub active: Card,
    pub bench: Vec<Card>,
    pub hand: Vec<u8>,
    pub points: u8,
    /// Cards this side has lost (Safe Haven counts them).
    pub faints: u8,
    /// This side's own turn count, so "round 1" abilities fire on its first turn.
    pub turns: u8,
    /// The deck this side brought: card ids in play order, an art skin for each, and the risk tier (crit rate).
    pub lineup: Vec<u8>,
    pub art: Vec<u8>,
    /// Max-HP bonus in percent for each lineup slot, earned by unlocked rare pictures (see collection.rs).
    pub perk: Vec<u8>,
    pub tier: u8,
}

/// A side as duels stored it before picture perks existed (no `perk` list). Only read, then converted.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct SideV1 {
    pub active: Card,
    pub bench: Vec<Card>,
    pub hand: Vec<u8>,
    pub points: u8,
    pub faints: u8,
    pub turns: u8,
    pub lineup: Vec<u8>,
    pub art: Vec<u8>,
    pub tier: u8,
}

/// A duel as stored before picture perks existed. Duels already on chain are read through this and converted.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct DuelV1 {
    pub sides: [SideV1; 2],
    pub mover: u8,
    pub turn: u32,
    pub energy_used: bool,
    pub retreated: bool,
    pub winner: Option<u8>,
    pub last_move_at: u64,
    pub log: Vec<LogEntry>,
}

impl From<SideV1> for Side {
    fn from(o: SideV1) -> Side {
        Side { active: o.active, bench: o.bench, hand: o.hand, points: o.points, faints: o.faints, turns: o.turns, lineup: o.lineup, art: o.art, perk: vec![0; 8], tier: o.tier }
    }
}

impl From<DuelV1> for Duel {
    fn from(o: DuelV1) -> Duel {
        let [a, b] = o.sides;
        Duel { sides: [a.into(), b.into()], mover: o.mover, turn: o.turn, energy_used: o.energy_used, retreated: o.retreated, winner: o.winner, last_move_at: o.last_move_at, log: o.log }
    }
}

#[cfg(test)]
impl DuelV1 {
    /// The old shape of a current duel (what the previous contract version would have stored).
    pub fn from_current(d: &Duel) -> DuelV1 {
        let side = |s: &Side| SideV1 { active: s.active.clone(), bench: s.bench.clone(), hand: s.hand.clone(), points: s.points, faints: s.faints, turns: s.turns, lineup: s.lineup.clone(), art: s.art.clone(), tier: s.tier };
        DuelV1 { sides: [side(&d.sides[0]), side(&d.sides[1])], mover: d.mover, turn: d.turn, energy_used: d.energy_used, retreated: d.retreated, winner: d.winner, last_move_at: d.last_move_at, log: d.log.clone() }
    }
}

/// One player's deck going into a duel: 8 distinct creature ids in play order (first leads, next 3 start on the bench,
/// last 4 in hand), an art skin per slot (0 = the default procedural face, 1.. = a card image), and the deck's risk
/// tier, which sets the crit rate.
#[derive(Clone, Debug, PartialEq)]
pub struct Setup {
    pub lineup: [u8; 8],
    pub art: [u8; 8],
    pub perk: [u8; 8],
    pub tier: u8,
}

impl Setup {
    /// The starter deck for a tier, with default art.
    pub fn tier(tier: u8) -> Setup {
        Setup { lineup: lineup(tier), art: [0; 8], perk: [0; 8], tier: tier % 3 }
    }
}

/// Highest art skin id (the app's reference image set is 1..=ART_MAX).
pub const ART_MAX: u8 = 102;

/// Check a custom deck: 8 distinct creatures from the 24, art ids in range. Returns the refusal text, if any.
pub fn check_deck(cards: &[u8], art: &[u8]) -> Result<(), &'static str> {
    if cards.len() != 8 || art.len() != 8 {
        return Err("a deck is 8 cards and 8 art picks");
    }
    for (i, c) in cards.iter().enumerate() {
        if *c as usize >= card_data::CARD_COUNT {
            return Err("unknown card");
        }
        if cards[..i].contains(c) {
            return Err("cards must be different");
        }
    }
    if art.iter().any(|a| *a > ART_MAX) {
        return Err("unknown art");
    }
    Ok(())
}

/// The HP perk of the lineup slot holding creature `id`.
fn perk_of(lineup: &[u8], perk: &[u8], id: u8) -> u8 {
    lineup.iter().position(|x| *x == id).and_then(|i| perk.get(i).copied()).unwrap_or(0)
}

fn make_side(s: &Setup) -> Side {
    let l = s.lineup;
    let k = s.perk;
    Side { active: card_perk(l[0], k[0]), bench: (1..4).map(|i| card_perk(l[i], k[i])).collect(), hand: l[4..].to_vec(), points: 0, faints: 0, turns: 0, lineup: l.to_vec(), art: s.art.to_vec(), perk: s.perk.to_vec(), tier: s.tier }
}

/// What a player can do on their turn. Stored in the log as `(action, arg)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Action {
    Attach,
    Attack,
    Power,
    Retreat(u8),
}

impl Action {
    /// 0 attach, 1 attack, 2 power attack, 3 retreat (arg = bench slot).
    pub fn parse(action: u8, arg: u8) -> Option<Action> {
        match action {
            0 => Some(Action::Attach),
            1 => Some(Action::Attack),
            2 => Some(Action::Power),
            3 => Some(Action::Retreat(arg)),
            _ => None,
        }
    }
}

/// One recorded move. For attacks: `card` is the attacker, `target` the card it hit, `damage` the total dealt.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LogEntry {
    pub side: u8,
    pub action: u8,
    pub arg: u8,
    pub card: u8,
    pub target: u8,
    pub damage: u32,
    pub crit: bool,
    pub dodged: bool,
    pub ko: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Duel {
    /// Side 0 is the challenger (player_a), side 1 the opponent (player_b).
    pub sides: [Side; 2],
    pub mover: u8,
    pub turn: u32,
    pub energy_used: bool,
    pub retreated: bool,
    /// Some(0) or Some(1) when someone has won, Some(2) for a draw.
    pub winner: Option<u8>,
    /// Unix seconds of the last move (or of the start). The mover forfeits after `TURN_SECS` of silence.
    pub last_move_at: u64,
    pub log: Vec<LogEntry>,
}

/// Why a move was refused. The contract turns these into panics.
#[derive(Debug, PartialEq)]
pub enum Refusal {
    Finished,
    AlreadyAttached,
    AlreadyRetreated,
    BadBench,
    NotEnoughEnergy,
    NoRetreatEnergy,
}

impl Refusal {
    pub fn message(&self) -> &'static str {
        match self {
            Refusal::Finished => "duel finished",
            Refusal::AlreadyAttached => "energy already attached this turn",
            Refusal::AlreadyRetreated => "already retreated this turn",
            Refusal::BadBench => "no card in that bench slot",
            Refusal::NotEnoughEnergy => "not enough energy to attack",
            Refusal::NoRetreatEnergy => "retreat costs 1 energy",
        }
    }
}

/// keccak256(seed || counter) % n, the same roll the spec engine uses.
struct Rng {
    seed: [u8; 32],
    ctr: u64,
}

impl Rng {
    fn roll(&mut self, n: u64) -> u64 {
        let mut buf = [0u8; 64];
        buf[..32].copy_from_slice(&self.seed);
        buf[56..].copy_from_slice(&self.ctr.to_be_bytes());
        self.ctr += 1;
        let hash = Keccak256::digest(buf);
        let mut r: u64 = 0;
        for b in hash.iter() {
            r = (r * 256 + *b as u64) % n;
        }
        r
    }
}

pub fn base_damage(atk_eff: u64, def_eff: u64) -> u64 {
    (atk_eff * 1000) / (50 + def_eff)
}

/// Damage a basic or power attack would deal before variance, crit and abilities. Handy for UI previews.
pub fn preview(attacker: &Card, defender: &Card, strong: bool) -> u32 {
    let (_, atk, def, _) = card_data::stats(attacker.id);
    let mut dmg = base_damage(atk as u64 + attacker.atk_bonus as u64, def as u64);
    dmg = dmg * (10000 + ENERGY_BPS * attacker.energy as u64) / 10000;
    if strong {
        dmg = dmg * POWER_PCT / 100;
    }
    (dmg * class_pct(attacker.id, defender.id) / 100) as u32
}

fn heal(c: &mut Card, mut amount: u32) -> u32 {
    if c.hp == 0 {
        return 0;
    }
    if c.halved {
        c.halved = false;
        amount /= 2;
    }
    let before = c.hp;
    c.hp = (c.hp + amount).min(c.max_hp);
    c.hp - before
}

fn spd(c: &Card) -> u32 {
    card_data::stats(c.id).3 as u32
}

#[derive(Default)]
struct Hit {
    damage: u32,
    self_damage: u32,
    crit: bool,
    dodged: bool,
}

impl Duel {
    /// Both sides play their tier's starter deck.
    pub fn new(tier_a: u8, tier_b: u8, seed: [u8; 32], now: u64) -> Duel {
        Self::with_decks(&Setup::tier(tier_a), &Setup::tier(tier_b), seed, now)
    }

    /// Start a duel between two (possibly custom) decks. The seed only breaks an SPD tie for who moves first.
    pub fn with_decks(a: &Setup, b: &Setup, seed: [u8; 32], now: u64) -> Duel {
        let sides = [make_side(a), make_side(b)];
        let mut rng = Rng { seed, ctr: 0 };
        let first = Self::initiative(&sides, &mut rng);
        let mut d = Duel { sides, mover: first, turn: 1, energy_used: false, retreated: false, winner: None, last_move_at: now, log: Vec::new() };
        d.begin_turn();
        d
    }

    /// Ape Comet always goes first, otherwise the higher SPD (Basis Kestrel borrows the enemy's if higher); ties roll.
    fn initiative(sides: &[Side; 2], rng: &mut Rng) -> u8 {
        let eff = |me: usize| {
            let (mine, theirs) = (&sides[me].active, &sides[1 - me].active);
            let own = spd(mine);
            let s = if mine.id == KESTREL { own.max(spd(theirs)) } else { own };
            if mine.id == COMET { u32::MAX } else { s }
        };
        let (a, b) = (eff(0), eff(1));
        if a > b {
            0
        } else if b > a {
            1
        } else {
            rng.roll(2) as u8
        }
    }

    /// Start-of-turn effects for the mover: Peg Shield refreshes, the turn counter ticks.
    fn begin_turn(&mut self) {
        let s = &mut self.sides[self.mover as usize];
        s.turns = s.turns.saturating_add(1);
        s.active.shield_cd = s.active.shield_cd.saturating_sub(1);
        for b in s.bench.iter_mut() {
            b.shield_cd = b.shield_cd.saturating_sub(1);
        }
    }

    /// Apply one move by the current mover. The caller has already checked who is calling. `seed` feeds any rolls;
    /// the contract derives it from the block's random seed so the mover cannot know the rolls in advance.
    pub fn play(&mut self, action: Action, now: u64, seed: [u8; 32]) -> Result<(), Refusal> {
        if self.winner.is_some() {
            return Err(Refusal::Finished);
        }
        let me = self.mover as usize;
        match action {
            Action::Attach => {
                if self.energy_used {
                    return Err(Refusal::AlreadyAttached);
                }
                let a = &mut self.sides[me].active;
                a.energy = (a.energy + 1).min(MAX_ENERGY);
                self.energy_used = true;
                let id = a.id;
                self.push(0, 0, id, id, 0, false, false, false);
            }
            Action::Retreat(i) => {
                if self.retreated {
                    return Err(Refusal::AlreadyRetreated);
                }
                let slot = i as usize;
                if slot >= self.sides[me].bench.len() {
                    return Err(Refusal::BadBench);
                }
                if self.sides[me].active.energy < RETREAT_COST {
                    return Err(Refusal::NoRetreatEnergy);
                }
                let side = &mut self.sides[me];
                side.active.energy -= RETREAT_COST;
                std::mem::swap(&mut side.active, &mut side.bench[slot]);
                self.retreated = true;
                let (out, inn) = (side.bench[slot].id, side.active.id);
                self.push(3, i, inn, out, 0, false, false, false);
            }
            Action::Attack | Action::Power => {
                let strong = action == Action::Power;
                let need = if strong { POWER_COST } else { 1 };
                if self.sides[me].active.energy < need {
                    return Err(Refusal::NotEnoughEnergy);
                }
                let mut rng = Rng { seed, ctr: 0 };
                let hits = if self.sides[me].active.id == KRAKEN { 2 } else { 1 };
                let attacker = self.sides[me].active.id;
                let (mut total, mut crit_any, mut dodged, mut ko) = (0u32, false, false, false);
                let mut target_id = self.sides[1 - me].active.id;
                for _ in 0..hits {
                    // Recursive Loop: each hit picks its target again, and stops if the Kraken is gone (E11).
                    if self.winner.is_some() || self.sides[me].active.id != attacker || self.sides[me].active.hp == 0 {
                        break;
                    }
                    target_id = self.sides[1 - me].active.id;
                    let h = self.strike(me, strong, &mut rng);
                    total += h.damage;
                    crit_any |= h.crit;
                    dodged |= h.dodged;
                    ko |= self.apply(me, &h);
                }
                self.push(if strong { 2 } else { 1 }, 0, attacker, target_id, total, crit_any, dodged, ko);
                if self.winner.is_none() {
                    self.end_turn();
                }
            }
        }
        self.last_move_at = now;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn push(&mut self, action: u8, arg: u8, card: u8, target: u8, damage: u32, crit: bool, dodged: bool, ko: bool) {
        self.log.push(LogEntry { side: self.mover, action, arg, card, target, damage, crit, dodged, ko });
    }

    /// The damage roll for one hit from the mover's active card against the other side's active card.
    fn strike(&mut self, me: usize, strong: bool, rng: &mut Rng) -> Hit {
        let foe = 1 - me;
        let mut h = Hit::default();
        let a = self.sides[me].active.clone();
        let d = self.sides[foe].active.clone();
        let (_, atk, def, _) = card_data::stats(a.id);
        let (_, _, ddef, _) = card_data::stats(d.id);
        let _ = def;

        let lynx = a.id == LYNX && self.sides[me].turns == 1;
        let atk_eff = ((atk as u64 + a.atk_bonus as u64) * (10000 + if lynx { 1000 } else { 0 })) / 10000;
        let mut def_mod: u64 = 10000;
        if d.id == GOLEM {
            def_mod += 1000 * self.sides[foe].faints.min(3) as u64;
        }
        if d.id == BEAR && d.hp * 2 < d.max_hp {
            def_mod += 1500;
        }
        if d.widen > 0 {
            def_mod -= 1000;
        }
        let mut def_eff = (ddef as u64 * def_mod) / 10000;
        if a.id == RAM && !a.used {
            self.sides[me].active.used = true;
            def_eff /= 2;
        }

        let mut dmg = base_damage(atk_eff, def_eff);
        dmg = dmg * (10000 + ENERGY_BPS * a.energy as u64) / 10000;
        if strong {
            dmg = dmg * POWER_PCT / 100;
        }
        dmg = dmg * class_pct(a.id, d.id) / 100;
        dmg = (dmg * (90 + rng.roll(21))) / 100;

        let (crit_bps, crit_mul) = crit(self.sides[me].tier);
        // The crit roll is always consumed, even when Audit cancels it (E8).
        if rng.roll(10000) < crit_bps + a.crit_bonus as u64 {
            let foe_active = &mut self.sides[foe].active;
            if foe_active.id == OWL && !foe_active.used {
                foe_active.used = true;
            } else {
                h.crit = true;
                dmg = (dmg * crit_mul) / 100;
            }
        }

        if a.id == KRAKEN {
            dmg = (dmg * 60) / 100;
        }
        if a.id == RAPTOR {
            if rng.roll(100) < 60 {
                dmg *= 2;
            } else {
                dmg /= 2;
                h.self_damage = a.max_hp / 10;
            }
        }

        if d.id == MANTIS && rng.roll(100) < 20 {
            h.dodged = true;
            return h;
        }
        let live = &mut self.sides[foe].active;
        if live.id == PEGSHELL && live.shield_cd == 0 {
            live.shield_cd = SHIELD_RECHARGE;
            return h;
        }
        if d.id == TORTOISE {
            dmg = (dmg * 90) / 100;
        }
        if dmg == 0 {
            dmg = 1;
        }
        h.damage = dmg as u32;
        h
    }

    /// Land the hit: damage, after-hit abilities, knockouts. Returns true if the defender's card was knocked out.
    fn apply(&mut self, me: usize, h: &Hit) -> bool {
        let foe = 1 - me;
        let mut ko = false;
        if h.damage > 0 {
            let (a, d) = Self::pair(&mut self.sides, me);
            if h.damage >= d.hp {
                if d.id == BISON && !d.used {
                    d.used = true;
                    d.hp = 1;
                } else {
                    d.hp = 0;
                }
            } else {
                d.hp -= h.damage;
            }
            if a.id == WOLF && d.hp * 5 < d.max_hp {
                d.hp = 0;
            }
            if d.id == CRAB {
                a.hp = a.hp.saturating_sub(h.damage / 10);
            }
            if a.id == WASP && a.hp > 0 {
                heal(a, h.damage * 30 / 100);
            }
            if a.id == SERPENT {
                d.widen = 2;
            }
            if a.id == HYDRA {
                d.halved = true;
            }
        }
        if h.self_damage > 0 {
            let a = &mut self.sides[me].active;
            a.hp = a.hp.saturating_sub(h.self_damage);
        }
        // Knockouts: the defender first, then the attacker (reflect and 2x Long can fell it).
        if self.sides[foe].active.hp == 0 {
            ko = true;
            self.knock_out(foe);
        }
        if self.winner.is_none() && self.sides[me].active.hp == 0 {
            self.knock_out(me);
        }
        ko
    }

    fn pair(sides: &mut [Side; 2], me: usize) -> (&mut Card, &mut Card) {
        let (l, r) = sides.split_at_mut(1);
        if me == 0 { (&mut l[0].active, &mut r[0].active) } else { (&mut r[0].active, &mut l[0].active) }
    }

    /// `side`'s active card fainted: the other side scores, and the next card steps up.
    fn knock_out(&mut self, side: usize) {
        let other = 1 - side;
        self.sides[other].points += 1;
        self.sides[side].faints += 1;
        let s = &mut self.sides[side];
        let no_cards_left = s.bench.is_empty() && s.hand.is_empty();
        if !no_cards_left {
            s.active = if !s.bench.is_empty() { s.bench.remove(0) } else { let id = s.hand.remove(0); card_perk(id, perk_of(&s.lineup, &s.perk, id)) };
            if !s.hand.is_empty() {
                let next = s.hand.remove(0);
                let k = perk_of(&s.lineup, &s.perk, next);
                s.bench.push(card_perk(next, k));
            }
        }
        let (pa, pb) = (self.sides[0].points >= WIN_POINTS, self.sides[1].points >= WIN_POINTS);
        let out = no_cards_left;
        self.winner = match (pa, pb) {
            (true, true) => Some(2),
            (true, false) => Some(0),
            (false, true) => Some(1),
            _ => {
                if out { Some(other as u8) } else { self.winner }
            }
        };
    }

    /// End-of-turn for the mover: heals, growth, free swaps, then debuff timers on the other side, then hand over.
    fn end_turn(&mut self) {
        let me = self.mover as usize;
        let s = &mut self.sides[me];
        let a = &mut s.active;
        if a.id == SENTINEL {
            heal(a, a.max_hp / 20);
        } else if a.id == BEETLE {
            heal(a, a.max_hp * 3 / 100);
        }
        if a.id == HERON && a.atk_bonus < 10 {
            a.atk_bonus += 2;
        }
        if a.id == PANTHER && a.crit_bonus < 2500 {
            a.crit_bonus += 500;
        }
        // Redeem (below 30% HP) and Rebalance (below 40% HP): once per match, swap with the first bench card, free.
        let threshold = match a.id {
            SPRITE => Some((3, 10)),
            FOX => Some((2, 5)),
            _ => None,
        };
        if let Some((n, dn)) = threshold {
            if !a.used && a.hp * dn < a.max_hp * n && !s.bench.is_empty() {
                s.active.used = true;
                std::mem::swap(&mut s.active, &mut s.bench[0]);
            }
        }
        let foe = &mut self.sides[1 - me];
        foe.active.widen = foe.active.widen.saturating_sub(1);
        for b in foe.bench.iter_mut() {
            b.widen = b.widen.saturating_sub(1);
        }
        self.mover = 1 - self.mover;
        self.turn += 1;
        self.energy_used = false;
        self.retreated = false;
        self.begin_turn();
    }

    /// The other side wins because `loser` forfeited or ran out of time.
    pub fn concede(&mut self, loser: u8, now: u64) {
        if self.winner.is_none() {
            self.winner = Some(1 - loser % 2);
            self.last_move_at = now;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: [u8; 32] = [3u8; 32];

    fn seed(n: u8) -> [u8; 32] {
        [n; 32]
    }

    /// Guardian vs Degen, Pegshell (spd 17) vs Leverage Raptor (spd 19): the Raptor moves first.
    fn new() -> Duel {
        Duel::new(0, 2, SEED, 1000)
    }

    fn set_first(d: &mut Duel, side: u8) {
        d.mover = side;
    }

    #[test]
    fn starts_from_the_spec_lineups_and_spd_decides_who_goes_first() {
        let d = new();
        assert_eq!(d.sides[0].active.id, 0);
        assert_eq!(d.sides[0].active.max_hp, 37 * 50);
        assert_eq!(d.sides[0].bench.iter().map(|c| c.id).collect::<Vec<_>>(), vec![1, 2, 3]);
        assert_eq!(d.sides[0].hand, vec![4, 5, 6, 7]);
        assert_eq!(d.sides[1].active.id, 16);
        assert_eq!(d.sides[0].active.energy, 0);
        assert_eq!(d.mover, 1); // Raptor spd 29 > Pegshell spd 17
        assert_eq!(d.sides[1].turns, 1);
        // Ape Comet (Degen, spd 33) leads against anyone
        let mut s = [make_side(&Setup::tier(0)), make_side(&Setup::tier(2))];
        s[1].active = card(COMET);
        let mut r = Rng { seed: SEED, ctr: 0 };
        assert_eq!(Duel::initiative(&s, &mut r), 1);
    }

    #[test]
    fn energy_and_retreat_once_per_turn_and_attack_ends_the_turn() {
        let mut d = new();
        set_first(&mut d, 0);
        d.sides[0].turns = 1;
        assert_eq!(d.play(Action::Attack, 1, SEED), Err(Refusal::NotEnoughEnergy));
        assert_eq!(d.play(Action::Retreat(0), 1, SEED), Err(Refusal::NoRetreatEnergy));
        d.play(Action::Attach, 1001, SEED).unwrap();
        assert_eq!(d.sides[0].active.energy, 1);
        assert_eq!(d.play(Action::Attach, 1002, SEED), Err(Refusal::AlreadyAttached));
        d.play(Action::Retreat(0), 1003, SEED).unwrap();
        // the retreat cost came out of the retreating card
        assert_eq!(d.sides[0].active.id, 1);
        assert_eq!(d.sides[0].bench[0].id, 0);
        assert_eq!(d.sides[0].bench[0].energy, 0);
        assert_eq!(d.play(Action::Retreat(1), 1004, SEED), Err(Refusal::AlreadyRetreated));
        assert_eq!(d.play(Action::Attack, 1005, SEED), Err(Refusal::NotEnoughEnergy)); // the new active has no energy
        assert_eq!(d.mover, 0);
    }

    #[test]
    fn attack_deals_spec_damage_scaled_by_energy_and_ends_the_turn() {
        let mut d = new();
        set_first(&mut d, 0);
        d.sides[0].active.energy = 2;
        let foe_hp = d.sides[1].active.hp;
        d.play(Action::Attack, 1001, seed(9)).unwrap();
        let dealt = foe_hp - d.sides[1].active.hp;
        let p = preview(&d.sides[0].active, &card(16), false);
        // 90..=110% variance, possibly a crit and Peg Shield / Mantis-free
        assert!(dealt as u64 >= p as u64 * 90 / 100 || d.log[0].crit == false, "dealt {dealt} vs preview {p}");
        assert!(d.log[0].damage == dealt);
        assert_eq!(d.mover, 1);
        assert_eq!(d.turn, 2);
        assert!(!d.energy_used && !d.retreated);
        assert_eq!(d.sides[1].turns, 2);
        assert_eq!(d.last_move_at, 1001);
    }

    #[test]
    fn power_attack_needs_three_energy_and_hits_harder() {
        let mut d = new();
        set_first(&mut d, 0);
        d.sides[0].active.energy = 2;
        assert_eq!(d.play(Action::Power, 1, SEED), Err(Refusal::NotEnoughEnergy));
        d.sides[0].active.energy = 3;
        let weak = preview(&d.sides[0].active, &d.sides[1].active, false);
        let strong = preview(&d.sides[0].active, &d.sides[1].active, true);
        assert!(strong > weak && strong == (weak as u64 * 160 / 100) as u32 || strong >= weak * 15 / 10);
        // energy caps at five
        let mut e = new();
        set_first(&mut e, 0);
        e.sides[0].active.energy = 5;
        e.play(Action::Attach, 1, SEED).unwrap();
        assert_eq!(e.sides[0].active.energy, 5);
    }

    #[test]
    fn class_wheel_gives_advantage_and_disadvantage() {
        // Pegshell is Stable (0), Treasury Sentinel is Treasury (1): Stable beats Treasury
        assert_eq!(class_pct(0, 1), 125);
        assert_eq!(class_pct(1, 0), 80);
        assert_eq!(class_pct(0, 0), 100);
        assert_eq!(class_pct(0, 8), 100); // Stable vs Gold: no relation
    }

    #[test]
    fn knockout_scores_promotes_and_refills_the_bench() {
        let mut d = new();
        set_first(&mut d, 0);
        d.sides[0].active.energy = 5;
        d.sides[1].active.hp = 1;
        d.play(Action::Attack, 1, seed(5)).unwrap();
        assert!(d.log.last().unwrap().ko);
        assert_eq!(d.sides[0].points, 1);
        assert_eq!(d.sides[1].faints, 1);
        assert_eq!(d.sides[1].active.id, 17); // first bench card steps up
        assert_eq!(d.sides[1].bench.iter().map(|c| c.id).collect::<Vec<_>>(), vec![18, 19, 20]);
        assert_eq!(d.sides[1].hand, vec![21, 22, 23]);
        assert_eq!(d.mover, 1);
    }

    #[test]
    fn three_knockouts_win_and_freeze_the_duel() {
        let mut d = new();
        for i in 0..3 {
            set_first(&mut d, 0);
            d.sides[0].active.energy = 5;
            d.sides[1].active.hp = 1;
            d.sides[1].active.used = false;
            d.play(Action::Attack, 1, seed(5 + i)).unwrap();
        }
        assert_eq!(d.winner, Some(0));
        assert_eq!(d.play(Action::Attack, 2, SEED), Err(Refusal::Finished));
        assert_eq!(d.play(Action::Attach, 2, SEED), Err(Refusal::Finished));
    }

    #[test]
    fn running_out_of_cards_also_wins() {
        let mut d = new();
        set_first(&mut d, 0);
        d.sides[0].active.energy = 5;
        d.sides[1].bench.clear();
        d.sides[1].hand.clear();
        d.sides[1].active.hp = 1;
        d.play(Action::Attack, 1, SEED).unwrap();
        assert_eq!(d.winner, Some(0));
    }

    #[test]
    fn abilities_shield_backstop_and_reflect() {
        // Peg Shield: blocks a hit, then needs time to recharge
        let mut d = Duel::new(0, 2, SEED, 0);
        set_first(&mut d, 1);
        d.sides[1].active.energy = 5;
        let hp = d.sides[0].active.hp;
        d.play(Action::Attack, 1, seed(2)).unwrap();
        assert_eq!(d.sides[0].active.hp, hp);
        assert_eq!(d.log[0].damage, 0);
        assert_eq!(d.sides[0].active.shield_cd, SHIELD_RECHARGE - 1); // already ticked once: it is that player's turn now
        // Backstop: a lethal hit leaves Reserve Bison on 1 HP, once
        let mut b = Duel::new(0, 2, SEED, 0);
        b.sides[0].active = card(BISON);
        b.sides[0].active.hp = 5;
        set_first(&mut b, 1);
        b.sides[1].active.energy = 5;
        b.play(Action::Attack, 1, seed(4)).unwrap();
        assert_eq!(b.sides[0].active.id, BISON);
        assert_eq!(b.sides[0].active.hp, 1);
        assert!(b.sides[0].active.used);
        // Hard Shell reflects 10% of damage taken
        let mut c = Duel::new(0, 2, SEED, 0);
        c.sides[0].active = card(CRAB);
        set_first(&mut c, 1);
        c.sides[1].active.energy = 5;
        let (mine, theirs) = (c.sides[1].active.hp, c.sides[0].active.hp);
        c.play(Action::Attack, 1, seed(6)).unwrap();
        let dealt = theirs - c.sides[0].active.hp;
        assert!(dealt > 0);
        // the Crab reflected a tenth of it (the attacker may also have healed or hurt itself via its own ability)
        assert!(mine > c.sides[1].active.hp || c.sides[1].active.id != 16 || dealt < 10);
    }

    #[test]
    fn end_of_turn_effects_heal_grow_and_swap() {
        // Treasury Sentinel heals 5% of max HP at the end of its turn
        let mut d = Duel::new(0, 2, SEED, 0);
        d.sides[0].active = card(SENTINEL);
        d.sides[0].active.hp = 100;
        d.sides[0].active.energy = 1;
        set_first(&mut d, 0);
        d.play(Action::Attack, 1, seed(8)).unwrap();
        assert_eq!(d.sides[0].active.hp, 100 + 35 * 50 / 20);
        // Yield Heron grows +2 ATK per turn
        let mut e = Duel::new(1, 2, SEED, 0);
        e.sides[0].active = card(HERON);
        e.sides[0].active.energy = 1;
        set_first(&mut e, 0);
        e.play(Action::Attack, 1, seed(8)).unwrap();
        assert_eq!(e.sides[0].active.atk_bonus, 2);
        // Mint Sprite below 30% HP swaps out for free, once
        let mut f = Duel::new(0, 2, SEED, 0);
        f.sides[0].active = card(SPRITE);
        f.sides[0].active.hp = 10;
        f.sides[0].active.energy = 1;
        set_first(&mut f, 0);
        f.play(Action::Attack, 1, seed(8)).unwrap();
        assert_ne!(f.sides[0].active.id, SPRITE);
        assert_eq!(f.sides[0].bench[0].id, SPRITE);
        assert!(f.sides[0].bench[0].used);
    }

    #[test]
    fn kraken_hits_twice_and_raptor_can_hurt_itself() {
        let mut d = Duel::new(2, 0, SEED, 0);
        d.sides[0].active = card(KRAKEN);
        d.sides[0].active.energy = 1;
        set_first(&mut d, 0);
        d.play(Action::Attack, 1, seed(3)).unwrap();
        assert_eq!(d.log.len(), 1);
        // two separate hits (each Peg Shield-free vs another card id)
        let mut e = Duel::new(2, 1, SEED, 0);
        e.sides[0].active = card(KRAKEN);
        e.sides[0].active.energy = 1;
        set_first(&mut e, 0);
        let hp = e.sides[1].active.hp;
        e.play(Action::Attack, 1, seed(3)).unwrap();
        assert!(e.sides[1].active.hp < hp);
    }

    #[test]
    fn concede_hands_the_win_to_the_other_side() {
        let mut d = new();
        d.concede(1, 50);
        assert_eq!(d.winner, Some(0));
        let mut e = new();
        e.concede(0, 50);
        assert_eq!(e.winner, Some(1));
        e.concede(1, 60);
        assert_eq!(e.winner, Some(1));
    }

    #[test]
    fn every_tier_matchup_plays_to_a_result() {
        for (ta, tb) in [(0, 0), (0, 1), (0, 2), (1, 1), (1, 2), (2, 2), (2, 0)] {
            for n in 0..4u8 {
                let mut d = Duel::new(ta, tb, seed(n), 0);
                let mut moves = 0u32;
                while d.winner.is_none() && moves < 400 {
                    if !d.energy_used {
                        d.play(Action::Attach, 0, seed(n.wrapping_add(moves as u8))).unwrap();
                    }
                    let e = d.sides[d.mover as usize].active.energy;
                    let act = if e >= POWER_COST { Action::Power } else { Action::Attack };
                    d.play(act, 0, seed(n.wrapping_add(moves as u8).wrapping_mul(7))).unwrap();
                    moves += 1;
                }
                assert!(d.winner.is_some(), "tiers {ta}v{tb} seed {n} did not end");
                let kos = d.log.iter().filter(|e| e.ko).count() as u8;
                assert!(kos >= 1);
                eprintln!("PACE {ta}v{tb} seed {n}: {} turns, winner {:?}, score {}-{}", d.turn, d.winner, d.sides[0].points, d.sides[1].points);
                assert!(d.turn < 80, "tiers {ta}v{tb} seed {n} took {} turns", d.turn);
            }
        }
    }

    #[test]
    fn custom_decks_set_the_lineup_art_and_the_tier_crit() {
        let guardian_cards_in_degen_deck = Setup { lineup: [0, 1, 2, 3, 4, 5, 6, 7], art: [5, 0, 7, 0, 0, 0, 0, 102], perk: [0; 8], tier: 2 };
        let d = Duel::with_decks(&guardian_cards_in_degen_deck, &Setup::tier(0), SEED, 0);
        assert_eq!(d.sides[0].tier, 2);
        assert_eq!(d.sides[0].lineup, vec![0, 1, 2, 3, 4, 5, 6, 7]);
        assert_eq!(d.sides[0].art, vec![5, 0, 7, 0, 0, 0, 0, 102]);
        assert_eq!(d.sides[0].active.id, 0);
        // a deck that leads with a different creature than its tier's default
        let odd = Setup { lineup: [23, 0, 9, 14, 3, 5, 12, 20], art: [0; 8], perk: [0; 8], tier: 1 };
        let d = Duel::with_decks(&odd, &Setup::tier(1), SEED, 0);
        assert_eq!(d.sides[0].active.id, 23);
        assert_eq!(d.sides[0].bench.iter().map(|c| c.id).collect::<Vec<_>>(), vec![0, 9, 14]);
        assert_eq!(d.sides[0].hand, vec![3, 5, 12, 20]);
        // tier 1 crit applies to every card of that deck
        assert_eq!(crit(d.sides[0].tier), (1200, 150));
    }

    #[test]
    fn deck_validation() {
        let ok = [0u8, 3, 9, 14, 16, 19, 21, 23];
        assert_eq!(check_deck(&ok, &[0; 8]), Ok(()));
        assert!(check_deck(&ok[..7], &[0; 8]).is_err());
        assert!(check_deck(&ok, &[0; 7]).is_err());
        assert_eq!(check_deck(&[0, 0, 1, 2, 3, 4, 5, 6], &[0; 8]), Err("cards must be different"));
        assert_eq!(check_deck(&[0, 1, 2, 3, 4, 5, 6, 24], &[0; 8]), Err("unknown card"));
        assert_eq!(check_deck(&ok, &[0, 0, 0, 0, 0, 0, 0, 103]), Err("unknown art"));
    }

    #[test]
    fn a_perk_adds_max_hp_to_the_card_it_is_on_including_cards_that_come_in_later() {
        let setup = Setup { lineup: [0, 1, 2, 3, 4, 5, 6, 7], art: [0; 8], perk: [5, 0, 0, 0, 0, 2, 0, 0], tier: 0 };
        let mut d = Duel::with_decks(&setup, &Setup::tier(2), SEED, 0);
        assert_eq!(d.sides[0].active.max_hp, 37 * 50 * 105 / 100);
        assert_eq!(d.sides[0].active.hp, d.sides[0].active.max_hp);
        assert_eq!(d.sides[0].bench[0].max_hp, 35 * 50); // no perk
        // card 5 sits in hand with a +2% perk: when it comes up it has the bonus
        assert_eq!(card_perk(5, 2).max_hp, 25 * 50 * 102 / 100);
        d.sides[0].bench.clear();
        d.sides[0].hand = vec![5];
        d.sides[0].active = card(2); // not Pegshell, so the hit lands
        d.sides[0].active.hp = 1;
        d.mover = 1;
        d.sides[1].active.energy = 5;
        d.play(Action::Attack, 1, seed(5)).unwrap();
        assert_eq!(d.sides[0].active.id, 5);
        assert_eq!(d.sides[0].active.max_hp, 25 * 50 * 102 / 100);
    }
}
