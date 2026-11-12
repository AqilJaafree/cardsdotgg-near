//! Fixed-point Elo, K = 32, floor 0. 10^(d/400) comes from a 25-point lookup with linear interpolation.
//! Port of contracts/src/libs/Elo.sol.
const ONE: i128 = 1_000_000;
const K: i128 = 32;
const T: [i128; 33] = [
    1000000, 1154782, 1333521, 1539927, 1778279, 2053525, 2371374, 2738420, 3162278, 3651741, 4216965, 4869675, 5623413, 6493816,
    7498942, 8659643, 10000000, 11547820, 13335214, 15399265, 17782794, 20535250, 23713737, 27384196, 31622777, 36517413, 42169650,
    48696753, 56234133, 64938163, 74989421, 86596432, 100000000,
];

fn pow(gap: i128) -> i128 {
    let i = (gap / 25) as usize;
    if i >= 32 {
        return T[32];
    }
    T[i] + ((T[i + 1] - T[i]) * (gap % 25)) / 25
}

/// Expected score of a player against an opponent, scaled by 1e6. Gap clamps to +/-800.
pub fn expected(player: u32, opponent: u32) -> i128 {
    if opponent >= player {
        let gap = ((opponent - player) as i128).min(800);
        return (ONE * ONE) / (ONE + pow(gap));
    }
    let g = ((player - opponent) as i128).min(800);
    ONE - (ONE * ONE) / (ONE + pow(g))
}

/// score is 1e6 win, 5e5 draw, 0 loss. Rounds to the nearest point.
pub fn next(player: u32, opponent: u32, score: i128) -> u32 {
    let mut d = K * (score - expected(player, opponent));
    d = if d >= 0 { (d + 500_000) / 1_000_000 } else { (d - 500_000) / 1_000_000 };
    let r = player as i128 + d;
    if r < 0 { 0 } else { r as u32 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equal_ratings_move_by_16() {
        assert_eq!(next(500, 500, 1_000_000), 516);
        assert_eq!(next(500, 500, 0), 484);
        assert_eq!(next(500, 500, 500_000), 500);
    }

    #[test]
    fn matches_reference() {
        assert_eq!(next(700, 500, 1_000_000), 708);
        assert_eq!(next(500, 700, 1_000_000), 524);
    }

    #[test]
    fn floors_at_zero() {
        assert_eq!(next(1, 500, 0), 0);
    }
}
