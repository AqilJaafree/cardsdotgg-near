//! Tokenized physical cards (real-world assets). Each token stands for exactly one physical card the owner holds:
//! one-of-one, never duplicated. The season pack hands out one token from the remaining stock, so the stock sells out
//! when every card has been pulled. A holder can transfer a token, or redeem it for the physical card, which burns the
//! token for good (it can never stand for a card that has left the vault).
//!
//! Tokens are collectibles only: they are not deck pictures and give no battle perk.
use near_sdk::{near, AccountId};
use sha3::{Digest, Keccak256};

/// The stock is a 32-bit sold bitmap, so at most 32 physical cards per season.
pub const MAX_CARDS: usize = 32;

/// The physical cards in the vault, in token id order, and which have been pulled from a pack.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Stock {
    /// What each token stands for, e.g. "SV11W 011 Tepig". Token id = index.
    pub cards: Vec<String>,
    /// Bit i set = token i has left the stock (pulled from a pack).
    pub sold: u32,
}

impl Stock {
    pub fn total(&self) -> u8 {
        self.cards.len() as u8
    }
    pub fn remaining(&self) -> u8 {
        (0..self.total()).filter(|i| self.sold >> i & 1 == 0).count() as u8
    }
    /// Take one card still in stock, chosen by `seed`. None when sold out.
    pub fn draw(&mut self, seed: &[u8; 32]) -> Option<u8> {
        let left: Vec<u8> = (0..self.total()).filter(|i| self.sold >> i & 1 == 0).collect();
        if left.is_empty() {
            return None;
        }
        let hash = Keccak256::digest([&seed[..], b"rwa"].concat());
        let mut r: u64 = 0;
        for b in hash.iter() {
            r = (r * 256 + *b as u64) % left.len() as u64;
        }
        let id = left[r as usize];
        self.sold |= 1 << id;
        Some(id)
    }
}

/// One minted token: who holds it and whether it has been redeemed for the physical card.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub owner: AccountId,
    /// Unix seconds when it was pulled from a pack.
    pub minted_at: u64,
    /// Set once the holder asks for the physical card. A redeemed token cannot move again.
    pub redeemed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stock(n: usize) -> Stock {
        Stock { cards: (0..n).map(|i| format!("card {i}")).collect(), sold: 0 }
    }

    #[test]
    fn every_card_is_drawn_exactly_once_then_it_sells_out() {
        let mut s = stock(23);
        let mut seen = vec![];
        for n in 0..23u8 {
            let id = s.draw(&[n; 32]).unwrap();
            assert!(id < 23 && !seen.contains(&id), "drew {id} twice");
            seen.push(id);
            assert_eq!(s.remaining(), 22 - n);
        }
        assert_eq!(s.draw(&[99; 32]), None);
        assert_eq!(s.remaining(), 0);
    }

    #[test]
    fn the_draw_depends_on_the_seed() {
        let a = stock(23).draw(&[1; 32]);
        let b = stock(23).draw(&[1; 32]);
        assert_eq!(a, b);
        assert!((0..20u8).any(|n| stock(23).draw(&[n; 32]) != a));
    }
}
