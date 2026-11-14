//! The arcade: mini games that earn tickets, and the ticket counter where tickets open packs.
//!
//! - Free play (Stacker): every play earns one Pack Ticket, up to `FREE_TICKETS_PER_DAY` per account per UTC day.
//!   A Pack Ticket opens one free trial pack.
//! - Paid play (Claw): costs `CLAW_PRICE` tUSD. Win or lose, the play becomes a Season Ticket that opens the White Flare
//!   pack. The win is the player's skill, reported by the app; it only sets the odds of the physical card drawn:
//!   a win draws a rare card with `WIN_RARE_BPS` chance, a loss with `LOSE_RARE_BPS`. The roll uses the block's
//!   random seed (NEAR's VRF-derived randomness), so the app cannot pick the card.
use near_sdk::near;
use sha3::{Digest, Keccak256};

pub const FREE_TICKETS_PER_DAY: u8 = 3;
/// 2 tUSD (6 decimals).
pub const CLAW_PRICE: u128 = 2_000_000;
pub const WIN_RARE_BPS: u64 = 7_500;
pub const LOSE_RARE_BPS: u64 = 2_500;

/// One account's tickets.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tickets {
    /// Opens one free trial pack.
    pub pack: u32,
    /// Season Tickets from a won claw play (75% rare).
    pub season_win: u32,
    /// Season Tickets from a lost claw play (25% rare).
    pub season_lose: u32,
    /// Paid claw plays whose result has not been reported yet.
    pub claw_pending: u32,
    /// UTC day number of `free_today`.
    pub free_day: u64,
    /// Free tickets earned on `free_day`.
    pub free_today: u8,
}

impl Tickets {
    /// Free tickets still available today (`day` = unix seconds / 86400).
    pub fn free_left(&self, day: u64) -> u8 {
        if self.free_day == day { FREE_TICKETS_PER_DAY.saturating_sub(self.free_today) } else { FREE_TICKETS_PER_DAY }
    }
    /// A free play: one Pack Ticket if today's cap allows. Returns whether a ticket was earned.
    pub fn free_play(&mut self, day: u64) -> bool {
        if self.free_day != day {
            self.free_day = day;
            self.free_today = 0;
        }
        if self.free_today >= FREE_TICKETS_PER_DAY {
            return false;
        }
        self.free_today += 1;
        self.pack += 1;
        true
    }
    /// Turn one pending claw play into a Season Ticket, by result.
    pub fn claw_result(&mut self, won: bool) -> Result<(), &'static str> {
        if self.claw_pending == 0 {
            return Err("no claw play to report");
        }
        self.claw_pending -= 1;
        if won { self.season_win += 1 } else { self.season_lose += 1 }
        Ok(())
    }
    /// Use one Season Ticket, won ones first. Returns whether it was a won ticket.
    pub fn take_season(&mut self) -> Result<bool, &'static str> {
        if self.season_win > 0 {
            self.season_win -= 1;
            Ok(true)
        } else if self.season_lose > 0 {
            self.season_lose -= 1;
            Ok(false)
        } else {
            Err("no season ticket: play the claw machine first")
        }
    }
}

fn roll(seed: &[u8; 32], tag: &[u8], n: u64) -> u64 {
    let hash = Keccak256::digest([&seed[..], tag].concat());
    let mut r: u64 = 0;
    for b in hash.iter() {
        r = (r * 256 + *b as u64) % n;
    }
    r
}

/// Draw one card still in stock (`sold` bit set = gone), aiming for a rare one with `rare_bps` chance. If the wanted
/// tier is empty the other tier is used, so a pack never fails while any card is left. Returns (token id, is rare).
pub fn draw_weighted(total: u8, sold: u32, rare: u32, rare_bps: u64, seed: &[u8; 32]) -> Option<(u8, bool)> {
    let left: Vec<u8> = (0..total).filter(|i| sold >> i & 1 == 0).collect();
    if left.is_empty() {
        return None;
    }
    let (r, c): (Vec<u8>, Vec<u8>) = left.iter().partition(|i| rare >> **i & 1 == 1);
    let want_rare = roll(seed, b"tier", 10_000) < rare_bps;
    let pool = if want_rare && !r.is_empty() || c.is_empty() { &r } else { &c };
    let id = pool[roll(seed, b"card", pool.len() as u64) as usize];
    Some((id, rare >> id & 1 == 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_play_caps_at_three_tickets_a_day_then_resets() {
        let mut t = Tickets::default();
        assert_eq!(t.free_left(10), 3);
        assert!(t.free_play(10) && t.free_play(10) && t.free_play(10));
        assert!(!t.free_play(10));
        assert_eq!((t.pack, t.free_left(10)), (3, 0));
        assert!(t.free_play(11));
        assert_eq!((t.pack, t.free_left(11)), (4, 2));
    }

    #[test]
    fn claw_results_become_season_tickets_and_won_ones_are_used_first() {
        let mut t = Tickets::default();
        assert!(t.claw_result(true).is_err());
        t.claw_pending = 2;
        t.claw_result(false).unwrap();
        t.claw_result(true).unwrap();
        assert_eq!((t.season_win, t.season_lose, t.claw_pending), (1, 1, 0));
        assert_eq!(t.take_season(), Ok(true));
        assert_eq!(t.take_season(), Ok(false));
        assert!(t.take_season().is_err());
    }

    #[test]
    fn rare_odds_follow_the_result_and_fall_back_when_a_tier_is_empty() {
        // 8 rare of 23, like the White Flare stock
        let rare: u32 = [1u8, 6, 10, 11, 13, 16, 18, 22].iter().map(|i| 1u32 << i).sum();
        let count = |bps: u64| (0..2000u32).filter(|n| draw_weighted(23, 0, rare, bps, &Keccak256::digest(n.to_be_bytes()).into()).unwrap().1).count();
        let win = count(WIN_RARE_BPS) as f64 / 2000.0;
        let lose = count(LOSE_RARE_BPS) as f64 / 2000.0;
        assert!((0.71..0.79).contains(&win), "win rare rate {win}");
        assert!((0.21..0.29).contains(&lose), "lose rare rate {lose}");
        // only commons left: a win still gets a card (a common)
        let (id, is_rare) = draw_weighted(23, rare, rare, 10_000, &[1; 32]).unwrap();
        assert!(!is_rare && rare >> id & 1 == 0);
        // only rares left: a loss still gets a card (a rare)
        let all: u32 = (1u32 << 23) - 1;
        assert!(draw_weighted(23, all & !rare, rare, 0, &[2; 32]).unwrap().1);
        assert_eq!(draw_weighted(23, all, rare, 5000, &[3; 32]), None);
    }
}
