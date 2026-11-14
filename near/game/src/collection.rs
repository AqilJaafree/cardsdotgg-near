//! Card collection: packs, owned creatures and pictures, and the rarity perk. Pure and deterministic given a seed.
//!
//! A pack costs `PACK_PRICE` tUSD and holds 5 pictures (2 common, 2 uncommon, 1 rare) plus 1 creature.
//! - Creatures: a deck can always use its own tier's 8 starter creatures; any other creature must be unlocked.
//! - Pictures: a card's picture must be one of the 24 starter pictures (the art on each starter deck) or unlocked.
//! - Perk: a picture unlocked from a pack adds max HP to the card wearing it (uncommon +2%, rare +5%). Starter pictures
//!   and the default picture give no perk, and one picture can be used once per deck, so the perk cannot stack.
use near_sdk::near;
use sha3::{Digest, Keccak256};

/// 2 tUSD (6 decimals).
pub const PACK_PRICE: u128 = 2_000_000;
pub const PICTURES: u8 = 102; // picture ids 1..=102
pub const CREATURES: u8 = 24;

/// The picture on each starter creature, creature id order (tier 0, then 1, then 2): same ids as the app's `decks`.
pub const STARTER_PICS: [u8; 24] = [15, 2, 1, 3, 13, 17, 30, 44, 14, 9, 16, 20, 21, 22, 58, 27, 4, 10, 12, 6, 8, 7, 5, 11];

pub fn is_starter_pic(p: u8) -> bool {
    STARTER_PICS.contains(&p)
}

/// 0 common, 1 uncommon, 2 rare. Same bands as the app: rare 1..=22, uncommon 23..=42, the rest common.
pub fn rarity(pic: u8) -> u8 {
    match pic {
        1..=22 => 2,
        23..=42 => 1,
        _ => 0,
    }
}

/// Extra max HP, in percent, for a card wearing an unlocked picture.
pub fn hp_bonus_pct(pic: u8) -> u8 {
    match rarity(pic) {
        2 => 5,
        1 => 2,
        _ => 0,
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pack {
    pub pictures: [u8; 5],
    pub creature: u8,
}

/// What an account owns. `creatures` bit i = creature i. `pics` bit p = picture p (bit 0 unused).
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Collection {
    pub creatures: u32,
    pub pics: u128,
    pub opened: u32,
    pub last: Option<Pack>,
}

impl Collection {
    pub fn has_creature(&self, c: u8) -> bool {
        c < CREATURES && self.creatures >> c & 1 == 1
    }
    pub fn has_pic(&self, p: u8) -> bool {
        p >= 1 && p <= PICTURES && self.pics >> p & 1 == 1
    }
    pub fn creature_list(&self) -> Vec<u8> {
        (0..CREATURES).filter(|c| self.has_creature(*c)).collect()
    }
    pub fn picture_list(&self) -> Vec<u8> {
        (1..=PICTURES).filter(|p| self.has_pic(*p)).collect()
    }
    /// Add a pack's contents.
    pub fn add(&mut self, pack: &Pack) {
        for p in pack.pictures {
            self.pics |= 1u128 << p;
        }
        self.creatures |= 1u32 << pack.creature;
        self.opened += 1;
        self.last = Some(pack.clone());
    }
}

fn roll(seed: &[u8; 32], ctr: u64, n: u64) -> u64 {
    let mut buf = [0u8; 64];
    buf[..32].copy_from_slice(seed);
    buf[56..].copy_from_slice(&ctr.to_be_bytes());
    let hash = Keccak256::digest(buf);
    let mut r: u64 = 0;
    for b in hash.iter() {
        r = (r * 256 + *b as u64) % n;
    }
    r
}

/// Draw one pack from a seed: 2 commons (43..=102), 2 uncommons (23..=42), 1 rare (1..=22), and 1 creature.
pub fn open(seed: [u8; 32]) -> Pack {
    let c1 = 43 + roll(&seed, 0, 60) as u8;
    let c2 = 43 + roll(&seed, 1, 60) as u8;
    let u1 = 23 + roll(&seed, 2, 20) as u8;
    let u2 = 23 + roll(&seed, 3, 20) as u8;
    let r = 1 + roll(&seed, 4, 22) as u8;
    Pack { pictures: [c1, c2, u1, u2, r], creature: roll(&seed, 5, CREATURES as u64) as u8 }
}

/// Is this deck allowed? `tier` gives the always-allowed starter creatures. Returns the refusal text.
pub fn check_ownership(col: &Collection, tier: u8, cards: &[u8], art: &[u8]) -> Result<(), &'static str> {
    for c in cards {
        let starter = *c / 8 == tier % 3;
        if !starter && !col.has_creature(*c) {
            return Err("creature not unlocked");
        }
    }
    for (i, a) in art.iter().enumerate() {
        if *a == 0 {
            continue;
        }
        if !is_starter_pic(*a) && !col.has_pic(*a) {
            return Err("picture not unlocked");
        }
        if art[..i].contains(a) {
            return Err("each picture can be used once per deck");
        }
    }
    Ok(())
}

/// The HP perk each slot earns: only pictures actually unlocked from packs count.
pub fn perks(col: &Collection, art: &[u8]) -> [u8; 8] {
    let mut out = [0u8; 8];
    for (i, a) in art.iter().enumerate().take(8) {
        if *a > 0 && !is_starter_pic(*a) && col.has_pic(*a) {
            out[i] = hp_bonus_pct(*a);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pack_has_the_right_mix_and_is_deterministic() {
        for n in 0..50u8 {
            let p = open([n; 32]);
            assert_eq!(p, open([n; 32]));
            assert!((43..=102).contains(&p.pictures[0]) && (43..=102).contains(&p.pictures[1]));
            assert!((23..=42).contains(&p.pictures[2]) && (23..=42).contains(&p.pictures[3]));
            assert!((1..=22).contains(&p.pictures[4]));
            assert!(p.creature < CREATURES);
        }
        assert_ne!(open([1; 32]), open([2; 32]));
    }

    #[test]
    fn rarity_bands_and_perks() {
        assert_eq!((rarity(1), rarity(22), rarity(23), rarity(42), rarity(43), rarity(102)), (2, 2, 1, 1, 0, 0));
        assert_eq!((hp_bonus_pct(5), hp_bonus_pct(30), hp_bonus_pct(80)), (5, 2, 0));
    }

    #[test]
    fn adding_a_pack_unlocks_its_cards_and_counts_it() {
        let mut c = Collection::default();
        let p = Pack { pictures: [50, 60, 25, 30, 7], creature: 19 };
        c.add(&p);
        assert!(c.has_creature(19) && !c.has_creature(18));
        assert!(c.has_pic(7) && c.has_pic(60) && !c.has_pic(8));
        assert_eq!((c.opened, c.last.clone()), (1, Some(p)));
        assert_eq!(c.creature_list(), vec![19]);
        assert_eq!(c.picture_list(), vec![7, 25, 30, 50, 60]);
        assert!(!c.has_pic(0) && !c.has_pic(103) && !c.has_creature(24));
    }

    #[test]
    fn deck_ownership_rules() {
        let mut c = Collection::default();
        let starters = [0u8, 1, 2, 3, 4, 5, 6, 7];
        // a Guardian deck can use its own 8 creatures and starter pictures with nothing unlocked
        assert_eq!(check_ownership(&c, 0, &starters, &[15, 2, 0, 0, 0, 0, 0, 0]), Ok(()));
        // another tier's creature, or an unowned picture, is refused
        assert_eq!(check_ownership(&c, 0, &[16, 1, 2, 3, 4, 5, 6, 7], &[0; 8]), Err("creature not unlocked"));
        assert_eq!(check_ownership(&c, 0, &starters, &[50, 0, 0, 0, 0, 0, 0, 0]), Err("picture not unlocked"));
        c.add(&Pack { pictures: [50, 60, 25, 30, 7], creature: 16 });
        assert_eq!(check_ownership(&c, 0, &[16, 1, 2, 3, 4, 5, 6, 7], &[50, 7, 0, 0, 0, 0, 0, 0]), Ok(()));
        // a picture cannot be used twice in one deck
        assert_eq!(check_ownership(&c, 0, &starters, &[50, 50, 0, 0, 0, 0, 0, 0]), Err("each picture can be used once per deck"));
    }

    #[test]
    fn only_unlocked_pack_pictures_give_a_perk() {
        let mut c = Collection::default();
        c.add(&Pack { pictures: [50, 60, 25, 30, 18], creature: 1 });
        // 18 (rare, unlocked) +5, 25 (uncommon, unlocked) +2, 50 (common) 0, 15 (a starter rare picture) 0, 19 (rare, not owned) 0
        assert_eq!(perks(&c, &[18, 25, 50, 15, 19, 0, 0, 0]), [5, 2, 0, 0, 0, 0, 0, 0]);
    }
}
