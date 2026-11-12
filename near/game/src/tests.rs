use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(predecessor: &str, height: u64, secs: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acc(predecessor))
        .block_height(height)
        .block_timestamp(secs * 1_000_000_000)
        .random_seed([7u8; 32]);
    b
}

const T0: u64 = 1_800_000_000;

fn game() -> Game {
    testing_env!(ctx("owner.near", 100, T0).build());
    let mut g = Game::new(acc("owner.near"), acc("keeper.near"), acc("tusd.near"), acc("tnear.near"), [500, 800, 1500], U128(4_000_000));
    // reserve 50,000 tUSD and liquidity in both tokens
    testing_env!(ctx("tusd.near", 100, T0).build());
    g.ft_on_transfer(acc("owner.near"), U128(50_000_000_000), r#"{"action":"reserve"}"#.into());
    g.ft_on_transfer(acc("owner.near"), U128(50_000_000_000), r#"{"action":"liquidity"}"#.into());
    testing_env!(ctx("tnear.near", 100, T0).build());
    g.ft_on_transfer(acc("owner.near"), U128(100 * NEAR_UNIT), r#"{"action":"liquidity"}"#.into());
    g
}

fn deposit(g: &mut Game, who: &str, token: &str, amount: u128, tier: u8, secs: u64) -> u64 {
    testing_env!(ctx(token, 100, secs).build());
    g.ft_on_transfer(acc(who), U128(amount), format!(r#"{{"action":"deposit","tier":{tier}}}"#));
    g.deck_count
}

#[test]
fn deposit_mints_deck_and_enforces_rules() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let d = g.get_deck(U64(a)).unwrap();
    assert_eq!(d.deposit_value_usd.0, 100_000_000);
    assert_eq!(g.stake_of_deck(U64(a)).0, 100_000);
    // tNEAR valued at the oracle price: 5 NEAR x $4 = $20
    let b = deposit(&mut g, "bob.near", "tnear.near", 5 * NEAR_UNIT, 2, T0);
    assert_eq!(g.get_deck(U64(b)).unwrap().deposit_value_usd.0, 20_000_000);
    assert!(g.deck_svg(U64(b)).contains("Degen Deck"));
}

#[test]
#[should_panic(expected = "below minimum")]
fn below_minimum_is_rejected() {
    let mut g = game();
    deposit(&mut g, "alice.near", "tusd.near", 9_000_000, 0, T0);
}

#[test]
#[should_panic(expected = "max decks")]
fn sixth_deck_is_rejected() {
    let mut g = game();
    for _ in 0..6 {
        deposit(&mut g, "alice.near", "tusd.near", 10_000_000, 0, T0);
    }
}

#[test]
fn yield_accrues_at_the_oracle_rate_across_a_rate_change() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let half = 365 * 86_400 / 2;
    testing_env!(ctx("alice.near", 101, T0 + half).build());
    assert_eq!(g.get_deck(U64(a)).unwrap().available.0, 2_500_000); // 100 tUSD at 5% for half a year
    testing_env!(ctx("keeper.near", 102, T0 + half).build());
    g.set_rates(1000, 800, 1500, 1); // the first keeper write skips the step cap
    testing_env!(ctx("alice.near", 103, T0 + 2 * half).build());
    assert_eq!(g.get_deck(U64(a)).unwrap().available.0, 7_500_000);
}

#[test]
fn oracle_step_cap_and_clamp() {
    let mut g = game();
    testing_env!(ctx("keeper.near", 101, T0).build());
    g.set_rates(9000, 800, 1500, 1);
    assert_eq!(g.oracle().rates_bps[0], 5000);
    g.set_rates(100, 2000, 1500, 2);
    assert_eq!(g.oracle().rates_bps[0], 4800);
    assert_eq!(g.oracle().rates_bps[1], 1000);
    testing_env!(ctx("keeper.near", 102, T0 + 24 * 3600 + 1).build());
    assert!(g.oracle().stale);
}

#[test]
#[should_panic(expected = "not keeper")]
fn only_the_keeper_writes_rates() {
    let mut g = game();
    testing_env!(ctx("alice.near", 101, T0).build());
    g.set_rates(1, 1, 1, 1);
}

fn play(g: &mut Game, a_deck: u64, b_deck: u64) -> u64 {
    testing_env!(ctx("alice.near", 110, T0 + 10).build());
    let id = g.create_challenge(U64(a_deck), Some(acc("bob.near"))).0;
    testing_env!(ctx("bob.near", 111, T0 + 11).build());
    g.accept(U64(id), U64(b_deck));
    testing_env!(ctx("anyone.near", 113, T0 + 14).build());
    g.resolve(U64(id));
    id
}

#[test]
fn staked_match_settles_95_5_and_updates_elo() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 200_000_000, 2, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    g.seed_escrow(U64(b), U128(1_000_000));
    let id = play(&mut g, a, b);
    let m = g.get_match(U64(id)).unwrap();
    assert_eq!(m.status, 3);
    assert_eq!(m.stake_a.0, 100_000);
    assert_eq!(m.stake_b.0, 200_000);
    let (da, db) = (g.get_deck(U64(a)).unwrap(), g.get_deck(U64(b)).unwrap());
    assert_eq!(da.locked.0 + db.locked.0, 0);
    match m.winner {
        Some(w) if w == acc("alice.near") => {
            assert_eq!(g.prize_pool().0, 200_000 * 5 / 100);
            assert_eq!(g.rating_of(acc("alice.near")), 516);
            assert_eq!(g.rating_of(acc("bob.near")), 484);
        }
        Some(_) => {
            assert_eq!(g.prize_pool().0, 100_000 * 5 / 100);
            assert_eq!(g.rating_of(acc("bob.near")), 516);
        }
        None => assert_eq!(g.rating_of(acc("alice.near")), 500),
    }
    assert_eq!(g.player_count(), 2);
}

#[test]
fn short_escrow_makes_the_match_rank_only() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    testing_env!(ctx("alice.near", 110, T0).build());
    let id = g.create_challenge(U64(a), None).0;
    assert_eq!(g.get_deck(U64(a)).unwrap().locked.0, 100_000);
    testing_env!(ctx("bob.near", 111, T0).build());
    g.accept(U64(id), U64(b));
    let m = g.get_match(U64(id)).unwrap();
    assert_eq!((m.stake_a.0, m.stake_b.0), (0, 0));
    assert_eq!(g.get_deck(U64(a)).unwrap().locked.0, 0);
}

#[test]
fn expire_refunds_after_an_hour() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    testing_env!(ctx("alice.near", 110, T0).build());
    let id = g.create_challenge(U64(a), None).0;
    testing_env!(ctx("anyone.near", 111, T0 + 3599).build());
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.expire(U64(id))));
    assert!(early.is_err());
    testing_env!(ctx("anyone.near", 112, T0 + 3600).build());
    g.expire(U64(id));
    assert_eq!(g.get_deck(U64(a)).unwrap().locked.0, 0);
}

#[test]
fn challenger_can_cancel_an_open_challenge_at_once() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    testing_env!(ctx("alice.near", 110, T0).build());
    let id = g.create_challenge(U64(a), None).0;
    assert!(g.get_deck(U64(a)).unwrap().locked.0 > 0);
    testing_env!(ctx("mallory.near", 111, T0 + 5).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.cancel(U64(id)))).is_err());
    testing_env!(ctx("alice.near", 112, T0 + 5).build());
    g.cancel(U64(id));
    assert_eq!(g.get_deck(U64(a)).unwrap().locked.0, 0);
    assert_eq!(g.get_match(U64(id)).unwrap().status, 4);
}

#[test]
#[should_panic(expected = "seed pending")]
fn cannot_resolve_before_the_seed_block() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("alice.near", 110, T0).build());
    let id = g.create_challenge(U64(a), None).0;
    testing_env!(ctx("bob.near", 111, T0).build());
    g.accept(U64(id), U64(b));
    testing_env!(ctx("anyone.near", 112, T0).build());
    g.resolve(U64(id)); // seed block is 112, needs a later block
}

#[test]
fn withdraw_pays_principal_plus_escrow_and_retires_the_deck() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    let q = g.quote_withdraw(U64(a), 0);
    assert_eq!((q.principal_out.0, q.escrow_out.0), (100_000_000, 1_000_000));
    testing_env!(ctx("alice.near", 106, T0).build());
    let _ = g.withdraw(U64(a), 0, U128(101_000_000));
    assert!(g.get_deck(U64(a)).unwrap().retired);
    assert_eq!(g.active_decks.get(&acc("alice.near")).copied(), Some(0));
}

#[test]
fn withdraw_to_tnear_uses_the_oracle_price() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(4_000_000));
    // 104 tUSD at $4 per NEAR is 26 tNEAR
    let q = g.quote_withdraw(U64(a), 1);
    assert_eq!(q.principal_out.0 + q.escrow_out.0, 26 * NEAR_UNIT);
}

#[test]
#[should_panic(expected = "stake locked")]
fn withdraw_is_blocked_while_a_stake_is_locked() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    testing_env!(ctx("alice.near", 110, T0).build());
    g.create_challenge(U64(a), None);
    let _ = g.withdraw(U64(a), 0, U128(0));
}

#[test]
fn simulate_view_matches_the_engine() {
    let g = game();
    let seed = "11".repeat(32);
    let r = g.simulate(seed.clone(), 0, 2);
    let log = g.simulate_with_log(seed, 0, 2);
    assert!(!log.is_empty());
    assert!(log.last().unwrap().round <= r.rounds);
}

#[test]
fn failed_payout_restores_the_deck_and_balances() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    let before = (g.liquidity()[0].0, g.liquidity()[1].0, g.total_principal);
    testing_env!(ctx("alice.near", 106, T0).build());
    let _ = g.withdraw(U64(a), 1, U128(0));
    assert!(g.get_deck(U64(a)).unwrap().retired);
    let (p, e) = (100_000_000u128, 1_000_000u128);
    let total = g.quote_withdraw_total_for_test(p, e);
    g.restore_withdraw(a, 1, total, p, e);
    let d = g.get_deck(U64(a)).unwrap();
    assert!(!d.retired);
    assert_eq!((d.principal.0, d.available.0), (p, e));
    assert_eq!((g.liquidity()[0].0, g.liquidity()[1].0, g.total_principal), before);
    assert_eq!(g.active_decks.get(&acc("alice.near")).copied(), Some(1));
}
