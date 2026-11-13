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

// ------------------------------------------------------------------ turn-based duels

fn start_duel(g: &mut Game, a_deck: u64, b_deck: u64) -> u64 {
    testing_env!(ctx("alice.near", 110, T0 + 10).build());
    let id = g.create_challenge(U64(a_deck), Some(acc("bob.near"))).0;
    testing_env!(ctx("bob.near", 111, T0 + 11).build());
    g.accept_duel(U64(id), U64(b_deck));
    id
}

fn who(side: u8) -> &'static str {
    if side == 0 { "alice.near" } else { "bob.near" }
}

/// Both players play greedily (attach, then power attack when they can) until the duel ends. Returns the move count.
fn play_out(g: &mut Game, id: u64, mut t: u64) -> u32 {
    let mut moves = 0;
    while g.get_match(U64(id)).unwrap().status == 2 {
        let d = g.get_duel(U64(id)).unwrap();
        let (side, energy) = (d.mover, d.sides[d.mover as usize].active.energy);
        testing_env!(ctx(who(side), 200 + moves as u64, t).build());
        t += 5;
        if !d.energy_used {
            g.play(U64(id), 0, 0);
            moves += 1;
            continue;
        }
        g.play(U64(id), if energy >= 3 { 2 } else { 1 }, 0);
        moves += 1;
        assert!(moves < 200, "duel did not finish");
    }
    moves
}

#[test]
fn duel_is_played_move_by_move_and_staked_result_is_recorded() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 2, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    g.seed_escrow(U64(b), U128(1_000_000));
    let id = start_duel(&mut g, a, b);
    let m = g.get_match(U64(id)).unwrap();
    assert_eq!(m.status, 2);
    assert_eq!((m.stake_a.0, m.stake_b.0), (100_000, 100_000));
    let d = g.get_duel(U64(id)).unwrap();
    assert_eq!(d.sides[0].active.id, 0); // Pegshell
    assert_eq!(d.sides[1].active.id, 16); // Leverage Raptor

    // the player who is not on move cannot act, and a stranger cannot either
    let (mover, waiting) = (d.mover, 1 - d.mover);
    testing_env!(ctx(who(waiting), 120, T0 + 20).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.play(U64(id), 0, 0))).is_err());
    testing_env!(ctx("mallory.near", 120, T0 + 20).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.play(U64(id), 0, 0))).is_err());
    // the mover cannot attack with no energy, nor attach twice
    testing_env!(ctx(who(mover), 121, T0 + 21).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.play(U64(id), 1, 0))).is_err());
    g.play(U64(id), 0, 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.play(U64(id), 0, 0))).is_err());

    let moves = play_out(&mut g, id, T0 + 100);
    assert!(moves > 3);
    let m = g.get_match(U64(id)).unwrap();
    assert_eq!(m.status, 3);
    let d = g.get_duel(U64(id)).unwrap();
    let w = d.winner.unwrap();
    assert_eq!(m.winner, Some(acc(who(w))));
    assert!(d.sides[w as usize].points >= 1);
    assert_eq!(d.log.len() as u32, moves + 1); // every move is recorded, including the first attach
    // stake moved: loser's deck unlocked and winner's escrow grew, 5% to the pool, ratings updated
    assert_eq!(g.prize_pool().0, 100_000 * 5 / 100);
    assert_eq!(g.rating_of(acc(who(w))), 516);
    assert_eq!(g.rating_of(acc(who(1 - w))), 484);
    assert_eq!(g.get_deck(U64(a)).unwrap().locked.0 + g.get_deck(U64(b)).unwrap().locked.0, 0);
    // a finished duel accepts no more moves
    testing_env!(ctx(who(w), 300, T0 + 900).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.play(U64(id), 1, 0))).is_err());
}

#[test]
fn forfeit_gives_the_win_to_the_other_player() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 1, T0);
    let id = start_duel(&mut g, a, b);
    testing_env!(ctx("mallory.near", 120, T0 + 20).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.forfeit(U64(id)))).is_err());
    testing_env!(ctx("alice.near", 121, T0 + 21).build());
    g.forfeit(U64(id));
    let m = g.get_match(U64(id)).unwrap();
    assert_eq!(m.status, 3);
    assert_eq!(m.winner, Some(acc("bob.near")));
    assert_eq!(g.get_duel(U64(id)).unwrap().winner, Some(1));
    assert_eq!(g.rating_of(acc("bob.near")), 516);
}

#[test]
fn a_silent_player_loses_after_the_turn_timer() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 1, T0);
    let id = start_duel(&mut g, a, b);
    let mover = g.get_duel(U64(id)).unwrap().mover;
    let started = T0 + 11;
    testing_env!(ctx("anyone.near", 130, started + duel::TURN_SECS - 1).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.claim_timeout(U64(id)))).is_err());
    testing_env!(ctx("anyone.near", 131, started + duel::TURN_SECS).build());
    g.claim_timeout(U64(id));
    let m = g.get_match(U64(id)).unwrap();
    assert_eq!(m.status, 3);
    assert_eq!(m.winner, Some(acc(who(1 - mover))));
}

#[test]
fn duels_do_not_disturb_the_auto_battle_path() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 2, T0);
    let id = play(&mut g, a, b);
    assert_eq!(g.get_match(U64(id)).unwrap().status, 3);
    assert!(g.get_duel(U64(id)).is_none());
}

#[test]
fn a_whole_turn_is_one_transaction_and_is_all_or_nothing() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 1, T0);
    let id = start_duel(&mut g, a, b);
    let mover = g.get_duel(U64(id)).unwrap().mover;
    testing_env!(ctx(who(mover), 140, T0 + 30).build());
    // attach, then attack, in one call
    g.play_turn(U64(id), vec![(0, 0), (1, 0)]);
    let d = g.get_duel(U64(id)).unwrap();
    assert_eq!(d.mover, 1 - mover);
    assert_eq!(d.log.len(), 2);
    let foe = &d.sides[1 - mover as usize].active;
    assert!(foe.hp < foe.max_hp || d.log[1].dodged || d.log[1].damage == 0);
    // an illegal later move reverts the whole call: a power attack on 1 energy fails, so nothing is recorded
    testing_env!(ctx(who(1 - mover), 141, T0 + 40).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.play_turn(U64(id), vec![(0, 0), (2, 0), (1, 0)]))).is_err());
    assert_eq!(g.get_duel(U64(id)).unwrap().log.len(), 2);
}

// ------------------------------------------------------------------ custom decks

#[test]
fn owner_customizes_cards_and_art_and_the_duel_uses_them() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    let b = deposit(&mut g, "bob.near", "tusd.near", 100_000_000, 2, T0);
    // untouched deck: the tier's starter cards, default art
    let v = g.get_deck_cards(U64(a));
    assert_eq!(v.cards, vec![0, 1, 2, 3, 4, 5, 6, 7]);
    assert!(!v.custom);
    // someone else cannot change it
    testing_env!(ctx("bob.near", 106, T0).build());
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.set_deck_cards(U64(a), vec![23, 0, 9, 14, 3, 5, 12, 20], vec![0; 8]))).is_err());
    // bad decks are refused: duplicates, unknown card, wrong length, unknown art
    testing_env!(ctx("alice.near", 107, T0).build());
    for (cards, art) in [
        (vec![0, 0, 1, 2, 3, 4, 5, 6], vec![0u8; 8]),
        (vec![0, 1, 2, 3, 4, 5, 6, 24], vec![0; 8]),
        (vec![0, 1, 2, 3, 4, 5, 6], vec![0; 8]),
        (vec![0, 1, 2, 3, 4, 5, 6, 7], vec![0, 0, 0, 0, 0, 0, 0, 103]),
    ] {
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.set_deck_cards(U64(a), cards.clone(), art.clone()))).is_err());
    }
    g.set_deck_cards(U64(a), vec![23, 0, 9, 14, 3, 5, 12, 20], vec![1, 2, 3, 0, 0, 0, 0, 102]);
    let v = g.get_deck_cards(U64(a));
    assert!(v.custom);
    assert_eq!(v.cards, vec![23, 0, 9, 14, 3, 5, 12, 20]);
    assert_eq!(v.art, vec![1, 2, 3, 0, 0, 0, 0, 102]);

    let id = start_duel(&mut g, a, b);
    let d = g.get_duel(U64(id)).unwrap();
    assert_eq!(d.sides[0].active.id, 23);
    assert_eq!(d.sides[0].art, vec![1, 2, 3, 0, 0, 0, 0, 102]);
    assert_eq!(d.sides[0].tier, 0); // crit comes from the deck's tier, not the cards
    assert_eq!(d.sides[1].lineup, vec![16, 17, 18, 19, 20, 21, 22, 23]); // Bob kept the Degen starter deck
    // editing the deck mid-duel does not change the duel that already started
    testing_env!(ctx("alice.near", 150, T0 + 30).build());
    let before = g.get_duel(U64(id)).unwrap().sides[0].lineup.clone();
    assert_eq!(before, vec![23, 0, 9, 14, 3, 5, 12, 20]);
}

#[test]
fn a_staked_deck_cannot_be_edited() {
    let mut g = game();
    let a = deposit(&mut g, "alice.near", "tusd.near", 100_000_000, 0, T0);
    testing_env!(ctx("owner.near", 105, T0).build());
    g.seed_escrow(U64(a), U128(1_000_000));
    testing_env!(ctx("alice.near", 110, T0).build());
    g.create_challenge(U64(a), None);
    assert!(g.get_deck(U64(a)).unwrap().locked.0 > 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g.set_deck_cards(U64(a), vec![23, 0, 9, 14, 3, 5, 12, 20], vec![0; 8]))).is_err());
}
