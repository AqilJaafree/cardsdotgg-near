//! Pure, deterministic auto-battle. A line-for-line port of contracts/src/engine/BattleEngine.sol, so the same
//! (seed, tierA, tierB) gives the same result on both. Rules: cardsdotgg.md "Battle engine" plus shared/engine-rules.md.
use crate::card_data;
use near_sdk::serde::Serialize;
use sha3::{Digest, Keccak256};

const NONE: u8 = 255;

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

/// kind: 0 attack, 1 heal, 2 end-of-round swap, 3 faint refill. Field meanings match shared/interfaces/Types.sol.
#[derive(Clone, Copy, Default, Serialize, Debug, PartialEq, Eq)]
#[serde(crate = "near_sdk::serde")]
pub struct Action {
    pub round: u8,
    pub side: u8,
    pub slot: u8,
    pub target_slot: u8,
    pub card_id: u8,
    pub damage: u32,
    pub crit: bool,
    pub dodged: bool,
    pub target_hp_after: u32,
    pub self_hp_after: u32,
    pub kind: u8,
    pub target_card_id: u8,
}

#[derive(Clone, Copy, Default)]
struct Card {
    id: u8,
    hp: u32,
    max_hp: u32,
    atk: u32,
    def: u32,
    spd: u32,
    atk_bonus: u32,
    def_bps: u32,
    crit_bonus: u32,
    widen: u8,
    halved: bool,
    shield_used: bool,
    used: bool,
}

#[derive(Clone, Copy, Default)]
struct Side {
    cards: [Card; 8],
    active: [u8; 3],
    bench: [u8; 5],
    tier: u8,
}

#[derive(Clone, Copy)]
struct Turn {
    side: u8,
    slot: u8,
    idx: u8,
    first: bool,
    spd: u32,
}

#[derive(Default)]
struct Hit {
    damage: u32,
    self_damage: u32,
    crit: bool,
    dodged: bool,
}

struct Ctx {
    sides: [Side; 2],
    seed: [u8; 32],
    ctr: u64,
    round: u8,
    logging: bool,
    log: Vec<Action>,
    done: bool,
    winner: u8,
}

/// winner_side: 0 A, 1 B, 2 draw. Shares are basis points of remaining HP.
pub struct SimResult {
    pub winner_side: u8,
    pub rounds: u8,
    pub hp_share_a: u16,
    pub hp_share_b: u16,
}

pub fn simulate(seed: [u8; 32], tier_a: u8, tier_b: u8) -> SimResult {
    let c = run(seed, tier_a, tier_b, false);
    SimResult { winner_side: c.winner, rounds: c.round, hp_share_a: share(&c.sides[0]), hp_share_b: share(&c.sides[1]) }
}

pub fn simulate_with_log(seed: [u8; 32], tier_a: u8, tier_b: u8) -> Vec<Action> {
    run(seed, tier_a, tier_b, true).log
}

/// Damage base from the spec formula: floor(ATK x 1000 / (50 + DEF)).
pub fn base_damage(atk_eff: u64, def_eff: u64) -> u64 {
    (atk_eff * 1000) / (50 + def_eff)
}

fn run(seed: [u8; 32], tier_a: u8, tier_b: u8, logging: bool) -> Ctx {
    assert!(tier_a < 3 && tier_b < 3, "tier");
    let mut c = Ctx { sides: [Side::default(); 2], seed, ctr: 0, round: 0, logging, log: Vec::new(), done: false, winner: 0 };
    init(&mut c.sides[0], tier_a);
    init(&mut c.sides[1], tier_b);
    for r in 1..=15u8 {
        c.round = r;
        play_round(&mut c);
        if c.done {
            return c;
        }
    }
    let a = share(&c.sides[0]);
    let b = share(&c.sides[1]);
    c.winner = if a > b { 0 } else if b > a { 1 } else { 2 };
    c
}

fn init(s: &mut Side, tier: u8) {
    s.tier = tier;
    s.active = [NONE; 3];
    s.bench = [NONE; 5];
    for i in 0..8u8 {
        let id = tier * 8 + i;
        let (hp, atk, def, spd) = card_data::stats(id);
        let k = &mut s.cards[i as usize];
        k.id = id;
        k.max_hp = hp as u32 * 50;
        k.hp = k.max_hp;
        k.atk = atk as u32;
        k.def = def as u32;
        k.spd = spd as u32;
        if i < 3 {
            s.active[i as usize] = i;
        } else {
            s.bench[(i - 3) as usize] = i;
        }
    }
}

/// keccak256(abi.encode(seed, ctr)) % n, with ctr as a 32-byte big-endian word, exactly as the Solidity engine rolls.
fn roll(c: &mut Ctx, n: u64) -> u64 {
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(&c.seed);
    buf[56..].copy_from_slice(&c.ctr.to_be_bytes());
    c.ctr += 1;
    let hash = Keccak256::digest(buf);
    let mut r: u64 = 0;
    for b in hash.iter() {
        r = (r * 256 + *b as u64) % n;
    }
    r
}

fn play_round(c: &mut Ctx) {
    for s in 0..2 {
        for i in 0..8 {
            c.sides[s].cards[i].shield_used = false;
        }
    }
    let tie = roll(c, 2) as u8;
    let (order, count) = order(c, tie);
    for t in order.iter().take(count) {
        let s = &c.sides[t.side as usize];
        if s.active[t.slot as usize] != t.idx || s.cards[t.idx as usize].hp == 0 {
            continue; // E3
        }
        act(c, *t);
        if c.done {
            return;
        }
    }
    end_of_round(c);
}

fn order(c: &Ctx, tie: u8) -> ([Turn; 6], usize) {
    let blank = Turn { side: 0, slot: 0, idx: 0, first: false, spd: 0 };
    let mut order = [blank; 6];
    let mut count = 0usize;
    for side in 0..2u8 {
        let s = &c.sides[side as usize];
        let e = &c.sides[1 - side as usize];
        for slot in 0..3u8 {
            let idx = s.active[slot as usize];
            if idx == NONE {
                continue;
            }
            let k = &s.cards[idx as usize];
            let t = Turn { side, slot, idx, first: k.id == COMET, spd: eff_spd(k, e) };
            let mut j = count;
            count += 1;
            while j > 0 && before(&t, &order[j - 1], tie) {
                order[j] = order[j - 1];
                j -= 1;
            }
            order[j] = t;
        }
    }
    (order, count)
}

fn eff_spd(k: &Card, enemy: &Side) -> u32 {
    let mut spd = k.spd;
    if k.id != KESTREL {
        return spd;
    }
    for i in 0..3 {
        let idx = enemy.active[i];
        if idx != NONE && enemy.cards[idx as usize].spd > spd {
            spd = enemy.cards[idx as usize].spd; // E10
        }
    }
    spd
}

fn before(a: &Turn, b: &Turn, tie: u8) -> bool {
    if a.first != b.first {
        return a.first;
    }
    if a.spd != b.spd {
        return a.spd > b.spd;
    }
    if a.side != b.side {
        return a.side == tie;
    }
    a.slot < b.slot
}

fn act(c: &mut Ctx, t: Turn) {
    let kraken = c.sides[t.side as usize].cards[t.idx as usize].id == KRAKEN;
    let hits = if kraken { 2 } else { 1 };
    for _ in 0..hits {
        if c.sides[t.side as usize].cards[t.idx as usize].hp == 0 {
            return;
        }
        let target_slot = target(&c.sides[1 - t.side as usize], t.slot); // E11: a second Loop hit retargets
        if target_slot == NONE {
            return;
        }
        hit(c, t, target_slot);
        if c.done {
            return;
        }
    }
}

fn target(e: &Side, slot: u8) -> u8 {
    if e.active[slot as usize] != NONE {
        return slot;
    }
    let mut best = NONE;
    let mut low = u32::MAX;
    for i in 0..3u8 {
        let idx = e.active[i as usize];
        if idx != NONE && e.cards[idx as usize].hp < low {
            low = e.cards[idx as usize].hp;
            best = i;
        }
    }
    best
}

fn hit(c: &mut Ctx, t: Turn, target_slot: u8) {
    let (si, ei) = (t.side as usize, 1 - t.side as usize);
    let target_idx = c.sides[ei].active[target_slot as usize];

    let h = compute_hit(c, si, ei, t.idx, target_idx);
    let mut a = c.sides[si].cards[t.idx as usize];
    let mut d = c.sides[ei].cards[target_idx as usize];
    apply_hit(&mut a, &mut d, &h);
    c.sides[si].cards[t.idx as usize] = a;
    c.sides[ei].cards[target_idx as usize] = d;

    if c.logging {
        c.log.push(Action {
            round: c.round,
            side: t.side,
            slot: t.slot,
            target_slot,
            card_id: a.id,
            damage: h.damage,
            crit: h.crit,
            dodged: h.dodged,
            target_hp_after: d.hp,
            self_hp_after: a.hp,
            kind: 0,
            target_card_id: d.id,
        });
    }

    if d.hp == 0 {
        faint(c, ei, target_slot);
    }
    if a.hp == 0 {
        faint(c, si, t.slot);
    }
    check_done(c);
}

fn compute_hit(c: &mut Ctx, si: usize, ei: usize, ai: u8, di: u8) -> Hit {
    let mut h = Hit::default();
    let a = c.sides[si].cards[ai as usize];
    let d = c.sides[ei].cards[di as usize];
    let tier = c.sides[si].tier;

    let atk_eff = ((a.atk + a.atk_bonus) as u64 * (10000 + if a.id == LYNX && c.round == 1 { 1000 } else { 0 })) / 10000; // E5
    let mut def_mod: u64 = 10000 + d.def_bps as u64;
    if d.id == BEAR && d.hp * 2 < d.max_hp {
        def_mod += 1500;
    }
    if d.widen > 0 {
        def_mod -= 1000;
    }
    let mut def_eff = (d.def as u64 * def_mod) / 10000;
    if a.id == RAM && !a.used {
        c.sides[si].cards[ai as usize].used = true;
        def_eff /= 2;
    }

    let mut dmg = (base_damage(atk_eff, def_eff) * (90 + roll(c, 21))) / 100;

    let (crit_bps, crit_mul) = crit(tier);
    if roll(c, 10000) < crit_bps + a.crit_bonus as u64 && !audit(&mut c.sides[ei]) {
        h.crit = true;
        dmg = (dmg * crit_mul) / 100;
    }

    if a.id == KRAKEN {
        dmg = (dmg * 60) / 100;
    }
    if a.id == RAPTOR {
        if roll(c, 100) < 60 {
            dmg *= 2;
        } else {
            dmg /= 2;
            h.self_damage = a.max_hp / 10;
        }
    }

    if d.id == MANTIS && roll(c, 100) < 20 {
        h.dodged = true;
        return h;
    }
    // Re-read the defender: Audit may have flipped its `used` flag, and Peg Shield state lives on the live card.
    let live = &mut c.sides[ei].cards[di as usize];
    if live.id == PEGSHELL && !live.shield_used {
        live.shield_used = true;
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

fn apply_hit(a: &mut Card, d: &mut Card, h: &Hit) {
    let dmg = h.damage;
    if dmg > 0 {
        if dmg >= d.hp {
            if d.id == BISON && !d.used {
                d.used = true;
                d.hp = 1;
            } else {
                d.hp = 0;
            }
        } else {
            d.hp -= dmg;
        }
        if a.id == WOLF && d.hp * 5 < d.max_hp {
            d.hp = 0;
        }
        if d.id == CRAB {
            a.hp = sub(a.hp, dmg / 10);
        }
        if a.id == WASP && a.hp > 0 {
            heal(a, (dmg * 30) / 100);
        }
        if a.id == SERPENT {
            d.widen = 2;
        }
        if a.id == HYDRA {
            d.halved = true;
        }
    }
    if h.self_damage > 0 {
        a.hp = sub(a.hp, h.self_damage);
    }
}

fn audit(e: &mut Side) -> bool {
    for i in 0..3 {
        let idx = e.active[i];
        if idx == NONE {
            continue;
        }
        let k = &mut e.cards[idx as usize];
        if k.id == OWL && !k.used && k.hp > 0 {
            k.used = true;
            return true;
        }
    }
    false
}

fn crit(tier: u8) -> (u64, u64) {
    match tier {
        0 => (500, 130),
        1 => (1200, 150),
        _ => (2500, 180),
    }
}

fn sub(hp: u32, amount: u32) -> u32 {
    if amount >= hp { 0 } else { hp - amount }
}

/// Returns HP actually restored. E6: caps at max, skips the fainted, Halving is used up by the next heal.
fn heal(k: &mut Card, mut amount: u32) -> u32 {
    if k.hp == 0 || amount == 0 {
        return 0;
    }
    if k.halved {
        k.halved = false;
        amount /= 2;
    }
    let restored = amount.min(k.max_hp - k.hp);
    k.hp += restored;
    restored
}

fn faint(c: &mut Ctx, side: usize, slot: u8) {
    let gone = c.sides[side].active[slot as usize];
    for i in 0..8u8 {
        let k = &mut c.sides[side].cards[i as usize];
        if k.id == GOLEM && k.hp > 0 && i != gone && k.def_bps < 3000 {
            k.def_bps += 1000;
        }
    }
    let (pos, next) = first_bench(&c.sides[side]);
    c.sides[side].active[slot as usize] = next;
    if next == NONE {
        return;
    }
    c.sides[side].bench[pos as usize] = NONE;
    log_move(c, 3, side as u8, slot, next, gone);
}

fn first_bench(s: &Side) -> (u8, u8) {
    for i in 0..5u8 {
        let b = s.bench[i as usize];
        if b != NONE && s.cards[b as usize].hp > 0 {
            return (i, b);
        }
    }
    (NONE, NONE)
}

fn log_move(c: &mut Ctx, kind: u8, side: u8, slot: u8, incoming: u8, outgoing: u8) {
    if !c.logging {
        return;
    }
    let inc = c.sides[side as usize].cards[incoming as usize];
    let out = c.sides[side as usize].cards[outgoing as usize];
    c.log.push(Action {
        round: c.round,
        side,
        slot,
        target_slot: slot,
        card_id: inc.id,
        damage: 0,
        crit: false,
        dodged: false,
        target_hp_after: out.hp,
        self_hp_after: inc.hp,
        kind,
        target_card_id: out.id,
    });
}

fn check_done(c: &mut Ctx) {
    let a_alive = alive(&c.sides[0]);
    let b_alive = alive(&c.sides[1]);
    if a_alive && b_alive {
        return;
    }
    c.done = true;
    c.winner = if a_alive { 0 } else if b_alive { 1 } else { 2 };
}

fn alive(s: &Side) -> bool {
    s.cards.iter().any(|k| k.hp > 0)
}

fn end_of_round(c: &mut Ctx) {
    for side in 0..2u8 {
        heal_step(c, side);
    }
    for side in 0..2 {
        growth_step(&mut c.sides[side]);
    }
    for side in 0..2u8 {
        swap_step(c, side);
    }
    for side in 0..2 {
        for i in 0..8 {
            let k = &mut c.sides[side].cards[i];
            if k.widen > 0 {
                k.widen -= 1;
            }
        }
    }
}

fn heal_step(c: &mut Ctx, side: u8) {
    for slot in 0..3u8 {
        let idx = c.sides[side as usize].active[slot as usize];
        if idx == NONE {
            continue;
        }
        let k = &mut c.sides[side as usize].cards[idx as usize];
        let amount = if k.id == SENTINEL {
            k.max_hp / 20
        } else if k.id == BEETLE {
            (k.max_hp * 3) / 100
        } else {
            0
        };
        if amount == 0 {
            continue;
        }
        let restored = heal(k, amount);
        let (id, hp) = (k.id, k.hp);
        if c.logging && restored > 0 {
            c.log.push(Action {
                round: c.round,
                side,
                slot,
                target_slot: slot,
                card_id: id,
                damage: restored,
                crit: false,
                dodged: false,
                target_hp_after: hp,
                self_hp_after: hp,
                kind: 1,
                target_card_id: id,
            });
        }
    }
}

fn growth_step(s: &mut Side) {
    for slot in 0..3 {
        let idx = s.active[slot];
        if idx == NONE {
            continue;
        }
        let k = &mut s.cards[idx as usize];
        if k.id == HERON && k.atk_bonus < 10 {
            k.atk_bonus += 2;
        }
        if k.id == PANTHER && k.crit_bonus < 2500 {
            k.crit_bonus += 500;
        }
    }
}

fn swap_step(c: &mut Ctx, side: u8) {
    for slot in 0..3u8 {
        let idx = c.sides[side as usize].active[slot as usize];
        if idx == NONE {
            continue;
        }
        let k = c.sides[side as usize].cards[idx as usize];
        if k.used {
            continue;
        }
        if k.id == SPRITE && k.hp * 10 < k.max_hp * 3 {
            if swap(c, side, slot) {
                c.sides[side as usize].cards[idx as usize].used = true;
            }
        } else if k.id == FOX {
            let low = lowest_below_40(&c.sides[side as usize]);
            if low != NONE && swap(c, side, low) {
                c.sides[side as usize].cards[idx as usize].used = true;
            }
        }
    }
}

fn lowest_below_40(s: &Side) -> u8 {
    let mut best = NONE;
    let mut low = u32::MAX;
    for i in 0..3u8 {
        let idx = s.active[i as usize];
        if idx == NONE {
            continue;
        }
        let k = &s.cards[idx as usize];
        if k.hp * 10 < k.max_hp * 4 && k.hp < low {
            low = k.hp;
            best = i;
        }
    }
    best
}

fn swap(c: &mut Ctx, side: u8, slot: u8) -> bool {
    let (pos, next) = first_bench(&c.sides[side as usize]);
    if next == NONE {
        return false;
    }
    let out = c.sides[side as usize].active[slot as usize];
    c.sides[side as usize].active[slot as usize] = next;
    c.sides[side as usize].bench[pos as usize] = out;
    log_move(c, 2, side, slot, next, out);
    true
}

fn share(s: &Side) -> u16 {
    let mut cur: u64 = 0;
    let mut max: u64 = 0;
    for k in s.cards.iter() {
        cur += k.hp as u64;
        max += k.max_hp as u64;
    }
    ((cur * 10000) / max) as u16 // E9
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formula_floors() {
        assert_eq!(base_damage(15, 35), 176);
        assert_eq!(base_damage(44, 8), 758);
    }

    #[test]
    fn same_seed_same_result() {
        for a in 0..3 {
            for b in 0..3 {
                let seed = Keccak256::digest([a, b]).into();
                let x = simulate(seed, a, b);
                let y = simulate(seed, a, b);
                assert_eq!((x.winner_side, x.rounds, x.hp_share_a, x.hp_share_b), (y.winner_side, y.rounds, y.hp_share_a, y.hp_share_b));
                assert_eq!(simulate_with_log(seed, a, b), simulate_with_log(seed, a, b));
            }
        }
    }

    /// Vectors printed by the Solidity engine (forge script script/Vectors.s.sol); the Rust port must agree exactly.
    #[test]
    fn matches_solidity_engine() {
        let text = include_str!("../vectors.txt");
        let mut n = 0;
        for line in text.lines().filter(|l| !l.trim().is_empty()) {
            let f: Vec<&str> = line.split(',').collect();
            let mut seed = [0u8; 32];
            seed.copy_from_slice(&hex(f[0]));
            let (ta, tb): (u8, u8) = (f[1].parse().unwrap(), f[2].parse().unwrap());
            let r = simulate(seed, ta, tb);
            let want: Vec<u32> = f[3..7].iter().map(|x| x.parse().unwrap()).collect();
            assert_eq!(vec![r.winner_side as u32, r.rounds as u32, r.hp_share_a as u32, r.hp_share_b as u32], want, "seed {} tiers {ta} {tb}", f[0]);
            let log = simulate_with_log(seed, ta, tb);
            assert_eq!(log.len() as u32, f[7].parse::<u32>().unwrap(), "log length, seed {}", f[0]);
            n += 1;
        }
        assert!(n >= 50, "expected at least 50 vectors, got {n}");
    }

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
    }
}
