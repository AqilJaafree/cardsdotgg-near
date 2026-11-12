//! tUSD/tNEAR constant-product pool with a 0.3% fee that stays in the reserves. Prices come only from the reserves.
//! NEP-141 tokens arrive through `ft_transfer_call` (credited to an internal balance), then the pool actions spend
//! that balance, then `withdraw` sends tokens back out. The pool opens at the price and depth of a Rhea mainnet pool.
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::store::LookupMap;
use near_sdk::{env, ext_contract, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue};
use uint::construct_uint;

construct_uint! { pub struct U256(4); }

pub const FEE_BPS: u128 = 30;
pub const MINIMUM_LIQUIDITY: u128 = 1000;
const DEAD: &str = "dead.near";

#[ext_contract(ext_ft)]
pub trait ExtFt {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
}

fn isqrt(n: U256) -> U256 {
    if n.is_zero() {
        return n;
    }
    let mut x = n;
    let mut y = (x + U256::one()) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    (U256::from(a) * U256::from(b) / U256::from(c)).as_u128()
}

/// Optional JSON in `ft_transfer_call`'s msg. An empty msg only credits the sender's pool balance.
///   {"action":"swap","min_out":"..."}                      swap the amount just sent, pay the output to the sender
///   {"action":"add","tusd_min":"...","tnear_min":"..."}    add liquidity once both tokens have arrived, in either order
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", tag = "action", rename_all = "snake_case")]
enum Msg {
    Swap { min_out: U128 },
    Add { tusd_min: U128, tnear_min: U128 },
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Position {
    pub shares: U128,
    pub tusd: U128,
    pub tnear: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Pool {
    tusd: AccountId,
    tnear: AccountId,
    reserves: [u128; 2],
    total_shares: u128,
    shares: LookupMap<AccountId, u128>,
    balances: LookupMap<AccountId, [u128; 2]>,
}

#[near]
impl Pool {
    #[init]
    pub fn new(tusd: AccountId, tnear: AccountId) -> Self {
        Self { tusd, tnear, reserves: [0; 2], total_shares: 0, shares: LookupMap::new(b"s"), balances: LookupMap::new(b"b") }
    }

    /// NEP-141 receiver: credits the sender's internal balance, then runs the optional action in `msg`.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        let i = self.index(&token);
        let mut gain = [0u128; 2];
        gain[i] = amount.0;
        self.credit(&sender_id, gain);
        if msg.trim().is_empty() {
            return PromiseOrValue::Value(U128(0));
        }
        let parsed: Msg = near_sdk::serde_json::from_str(&msg).unwrap_or_else(|_| env::panic_str("pool: bad msg"));
        match parsed {
            Msg::Swap { min_out } => {
                let out = self.do_swap(&sender_id, i as u8, amount.0, min_out.0);
                let o = 1 - i;
                let mut spend = [0u128; 2];
                spend[o] = out;
                self.debit(&sender_id, spend);
                let p = self.transfer_out(&sender_id, o as u8, out).then(
                    Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_swap_out(sender_id, o as u8, U128(out)),
                );
                PromiseOrValue::Promise(p)
            }
            Msg::Add { tusd_min, tnear_min } => {
                let b = self.balances.get(&sender_id).copied().unwrap_or([0; 2]);
                if b[0] > 0 && b[1] > 0 {
                    self.do_add(&sender_id, b[0], b[1], tusd_min.0, tnear_min.0);
                }
                PromiseOrValue::Value(U128(0))
            }
        }
    }

    /// Adds liquidity from the caller's internal balances at the pool's ratio; any extra stays in the balance.
    pub fn add_liquidity(&mut self, tusd_desired: U128, tnear_desired: U128, tusd_min: U128, tnear_min: U128) -> U128 {
        let who = env::predecessor_account_id();
        U128(self.do_add(&who, tusd_desired.0, tnear_desired.0, tusd_min.0, tnear_min.0))
    }

    /// Burns shares and credits the redeemed tokens to the caller's internal balance.
    pub fn remove_liquidity(&mut self, shares: U128, tusd_min: U128, tnear_min: U128) -> (U128, U128) {
        let who = env::predecessor_account_id();
        require!(shares.0 > 0, "pool: zero shares");
        let held = self.shares.get(&who).copied().unwrap_or(0);
        require!(held >= shares.0, "pool: not enough shares");
        let (u_out, n_out) = self.redeemable(shares.0);
        require!(u_out >= tusd_min.0 && n_out >= tnear_min.0, "pool: slippage");
        self.shares.insert(who.clone(), held - shares.0);
        self.total_shares -= shares.0;
        self.reserves[0] -= u_out;
        self.reserves[1] -= n_out;
        self.credit(&who, [u_out, n_out]);
        env::log_str(&format!("LiquidityRemoved {u_out} {n_out} {}", shares.0));
        (U128(u_out), U128(n_out))
    }

    /// asset_in: 0 tUSD, 1 tNEAR. Spends the caller's internal balance and credits the output to it.
    pub fn swap(&mut self, asset_in: u8, amount_in: U128, min_out: U128) -> U128 {
        let who = env::predecessor_account_id();
        require!(asset_in <= 1, "pool: asset");
        let out = self.do_swap(&who, asset_in, amount_in.0, min_out.0);
        U128(out)
    }

    /// Sends tokens from the caller's internal balance back to their wallet. Restored if the transfer fails.
    pub fn withdraw(&mut self, asset: u8, amount: U128) -> Promise {
        require!(asset <= 1, "pool: asset");
        let who = env::predecessor_account_id();
        let mut spend = [0u128; 2];
        spend[asset as usize] = amount.0;
        self.debit(&who, spend);
        self.transfer_out(&who, asset, amount.0)
            .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_withdraw(who, asset, amount))
    }

    /// Sends the caller's whole internal balance of both tokens back to their wallet.
    pub fn withdraw_all(&mut self) {
        let who = env::predecessor_account_id();
        let b = self.balances.get(&who).copied().unwrap_or([0; 2]);
        for asset in 0..2u8 {
            let amount = b[asset as usize];
            if amount == 0 {
                continue;
            }
            let mut spend = [0u128; 2];
            spend[asset as usize] = amount;
            self.debit(&who, spend);
            let _ = self
                .transfer_out(&who, asset, amount)
                .then(Self::ext(env::current_account_id()).with_static_gas(Gas::from_tgas(10)).on_withdraw(who.clone(), asset, U128(amount)));
        }
    }

    #[private]
    pub fn on_withdraw(&mut self, who: AccountId, asset: u8, amount: U128, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_err() {
            let mut gain = [0u128; 2];
            gain[asset as usize] = amount.0;
            self.credit(&who, gain);
        }
    }

    /// Callback for a one-signature swap: if paying the output failed, keep it in the sender's pool balance.
    #[private]
    pub fn on_swap_out(&mut self, who: AccountId, asset: u8, amount: U128, #[callback_result] result: Result<(), PromiseError>) -> U128 {
        if result.is_err() {
            let mut gain = [0u128; 2];
            gain[asset as usize] = amount.0;
            self.credit(&who, gain);
        }
        U128(0)
    }

    pub fn reserves(&self) -> (U128, U128) {
        (U128(self.reserves[0]), U128(self.reserves[1]))
    }

    pub fn total_shares(&self) -> U128 {
        U128(self.total_shares)
    }

    pub fn balances_of(&self, account_id: AccountId) -> (U128, U128) {
        let b = self.balances.get(&account_id).copied().unwrap_or([0; 2]);
        (U128(b[0]), U128(b[1]))
    }

    pub fn quote_swap(&self, asset_in: u8, amount_in: U128) -> U128 {
        U128(self.quote(asset_in, amount_in.0))
    }

    /// What an account's shares redeem for right now.
    pub fn position_of(&self, account_id: AccountId) -> Position {
        let shares = self.shares.get(&account_id).copied().unwrap_or(0);
        let (u, n) = if shares > 0 { self.redeemable(shares) } else { (0, 0) };
        Position { shares: U128(shares), tusd: U128(u), tnear: U128(n) }
    }

    pub fn fee_bps(&self) -> u32 {
        FEE_BPS as u32
    }
}

impl Pool {
    fn transfer_out(&self, who: &AccountId, asset: u8, amount: u128) -> Promise {
        let token = if asset == 0 { self.tusd.clone() } else { self.tnear.clone() };
        ext_ft::ext(token)
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(Gas::from_tgas(15))
            .ft_transfer(who.clone(), U128(amount), None)
    }

    fn do_swap(&mut self, who: &AccountId, asset_in: u8, amount_in: u128, min_out: u128) -> u128 {
        require!(amount_in > 0, "pool: zero in");
        let out = self.quote(asset_in, amount_in);
        require!(out > 0, "pool: zero out");
        require!(out >= min_out, "pool: slippage");
        let (i, o) = (asset_in as usize, 1 - asset_in as usize);
        let mut spend = [0u128; 2];
        spend[i] = amount_in;
        self.debit(who, spend);
        self.reserves[i] += amount_in;
        self.reserves[o] -= out;
        let mut gain = [0u128; 2];
        gain[o] = out;
        self.credit(who, gain);
        env::log_str(&format!("Swapped {asset_in} {amount_in} {out}"));
        out
    }

    fn do_add(&mut self, who: &AccountId, u_des: u128, n_des: u128, u_min: u128, n_min: u128) -> u128 {
        let (u_in, n_in, minted);
        if self.total_shares == 0 {
            u_in = u_des;
            n_in = n_des;
            let root = isqrt(U256::from(u_in) * U256::from(n_in)).as_u128();
            require!(root > MINIMUM_LIQUIDITY, "pool: too small");
            minted = root - MINIMUM_LIQUIDITY;
            self.shares.insert(DEAD.parse().unwrap(), MINIMUM_LIQUIDITY);
            self.total_shares += MINIMUM_LIQUIDITY;
        } else {
            let n_opt = mul_div(u_des, self.reserves[1], self.reserves[0]);
            if n_opt <= n_des {
                u_in = u_des;
                n_in = n_opt;
            } else {
                u_in = mul_div(n_des, self.reserves[0], self.reserves[1]);
                n_in = n_des;
            }
            minted = mul_div(u_in, self.total_shares, self.reserves[0]).min(mul_div(n_in, self.total_shares, self.reserves[1]));
        }
        require!(u_in >= u_min && n_in >= n_min, "pool: slippage");
        require!(minted > 0, "pool: zero shares");
        self.debit(who, [u_in, n_in]);
        self.reserves[0] += u_in;
        self.reserves[1] += n_in;
        self.total_shares += minted;
        let held = self.shares.get(who).copied().unwrap_or(0);
        self.shares.insert(who.clone(), held + minted);
        env::log_str(&format!("LiquidityAdded {u_in} {n_in} {minted}"));
        minted
    }

    fn index(&self, token: &AccountId) -> usize {
        if *token == self.tusd {
            0
        } else if *token == self.tnear {
            1
        } else {
            env::panic_str("unknown token")
        }
    }

    fn debit(&mut self, who: &AccountId, amounts: [u128; 2]) {
        let mut b = self.balances.get(who).copied().unwrap_or([0; 2]);
        for i in 0..2 {
            require!(b[i] >= amounts[i], "pool: deposit tokens first");
            b[i] -= amounts[i];
        }
        self.balances.insert(who.clone(), b);
    }

    fn credit(&mut self, who: &AccountId, amounts: [u128; 2]) {
        let mut b = self.balances.get(who).copied().unwrap_or([0; 2]);
        for i in 0..2 {
            b[i] += amounts[i];
        }
        self.balances.insert(who.clone(), b);
    }

    fn quote(&self, asset_in: u8, amount_in: u128) -> u128 {
        let (r_in, r_out) = if asset_in == 0 { (self.reserves[0], self.reserves[1]) } else { (self.reserves[1], self.reserves[0]) };
        if r_in == 0 || r_out == 0 {
            return 0;
        }
        let in_after_fee = U256::from(amount_in) * U256::from(10_000 - FEE_BPS);
        (in_after_fee * U256::from(r_out) / (U256::from(r_in) * U256::from(10_000u32) + in_after_fee)).as_u128()
    }

    fn redeemable(&self, shares: u128) -> (u128, u128) {
        (mul_div(shares, self.reserves[0], self.total_shares), mul_div(shares, self.reserves[1], self.total_shares))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const N: u128 = 1_000_000_000_000_000_000_000_000;

    fn acc(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn as_(who: &str) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(acc(who)).build());
    }
    fn fund(p: &mut Pool, who: &str, usd: u128, near: u128) {
        as_("tusd.near");
        let _ = p.ft_on_transfer(acc(who), U128(usd), String::new());
        as_("tnear.near");
        let _ = p.ft_on_transfer(acc(who), U128(near), String::new());
    }
    fn pool() -> Pool {
        testing_env!(VMContextBuilder::new().build()); // fresh mocked storage for every pool
        let mut p = Pool::new(acc("tusd.near"), acc("tnear.near"));
        fund(&mut p, "lp.near", 40_000_000_000, 10_000 * N);
        as_("lp.near");
        p.add_liquidity(U128(40_000_000_000), U128(10_000 * N), U128(0), U128(0));
        p
    }

    #[test]
    fn first_deposit_locks_minimum_liquidity() {
        let p = pool();
        assert_eq!(p.shares.get(&acc(DEAD)).copied(), Some(MINIMUM_LIQUIDITY));
        assert_eq!(p.position_of(acc("lp.near")).shares.0 + MINIMUM_LIQUIDITY, p.total_shares);
    }

    #[test]
    fn swap_pays_constant_product_less_fee() {
        let mut p = pool();
        fund(&mut p, "trader.near", 1_000_000_000, 0);
        as_("trader.near");
        let quote = p.quote_swap(0, U128(1_000_000_000)).0;
        // 1000 x 0.997 x 10000 / (40000 + 997) = 243.188... tNEAR
        assert!(quote > 243 * N && quote < 244 * N);
        assert_eq!(p.swap(0, U128(1_000_000_000), U128(quote)).0, quote);
        assert_eq!(p.reserves().0 .0, 41_000_000_000);
        assert_eq!(p.balances_of(acc("trader.near")).1 .0, quote);
    }

    #[test]
    #[should_panic(expected = "pool: slippage")]
    fn swap_slippage_reverts() {
        let mut p = pool();
        fund(&mut p, "trader.near", 1_000_000_000, 0);
        as_("trader.near");
        let quote = p.quote_swap(0, U128(1_000_000_000)).0;
        p.swap(0, U128(1_000_000_000), U128(quote + 1));
    }

    #[test]
    #[should_panic(expected = "deposit tokens first")]
    fn cannot_spend_without_depositing() {
        let mut p = pool();
        as_("trader.near");
        p.swap(0, U128(1_000_000_000), U128(0));
    }

    #[test]
    fn lp_earns_fees_from_swaps() {
        let mut p = pool();
        fund(&mut p, "trader.near", 20_000_000_000, 5 * N);
        as_("trader.near");
        let k0 = U256::from(p.reserves().0 .0) * U256::from(p.reserves().1 .0);
        for _ in 0..5 {
            let out = p.swap(0, U128(2_000_000_000), U128(0)).0;
            p.swap(1, U128(out), U128(0));
        }
        let k1 = U256::from(p.reserves().0 .0) * U256::from(p.reserves().1 .0);
        assert!(k1 > k0, "k must grow by the fee");
    }

    #[test]
    fn add_is_proportional_and_extra_stays_in_balance() {
        let mut p = pool();
        fund(&mut p, "lp2.near", 4_000_000_000, 5_000 * N);
        as_("lp2.near");
        p.add_liquidity(U128(4_000_000_000), U128(5_000 * N), U128(0), U128(0));
        // the pool ratio is 4 tUSD per tNEAR... 4000 tUSD needs 1000 tNEAR; the other 4000 stay in the balance
        assert_eq!(p.balances_of(acc("lp2.near")).1 .0, 4_000 * N);
    }

    #[test]
    fn add_then_remove_cannot_profit() {
        let mut p = pool();
        fund(&mut p, "lp2.near", 4_000_000_000, 1_000 * N);
        as_("lp2.near");
        let s = p.add_liquidity(U128(4_000_000_000), U128(1_000 * N), U128(0), U128(0)).0;
        let (u, n) = p.remove_liquidity(U128(s), U128(0), U128(0));
        assert!(u.0 <= 4_000_000_000 && n.0 <= 1_000 * N);
    }

    #[test]
    fn opens_at_realistic_rhea_depth_without_overflow() {
        let mut p = Pool::new(acc("tusd.near"), acc("tnear.near"));
        let usd = 977_000_000_000u128; // $977k
        let near = 261_000 * N;
        fund(&mut p, "deployer.near", usd, near);
        as_("deployer.near");
        assert!(p.add_liquidity(U128(usd), U128(near), U128(usd), U128(near)).0 > 0);
    }

    const ADD: &str = r#"{"action":"add","tusd_min":"0","tnear_min":"0"}"#;

    #[test]
    fn one_transfer_swap_pays_out_and_leaves_no_balance() {
        let mut p = pool();
        let quote = p.quote_swap(0, U128(1_000_000_000)).0;
        as_("tusd.near");
        let msg = format!(r#"{{"action":"swap","min_out":"{quote}"}}"#);
        let r = p.ft_on_transfer(acc("trader.near"), U128(1_000_000_000), msg);
        assert!(matches!(r, PromiseOrValue::Promise(_)));
        assert_eq!(p.reserves().0 .0, 41_000_000_000);
        assert_eq!(p.balances_of(acc("trader.near")), (U128(0), U128(0)));
    }

    #[test]
    #[should_panic(expected = "pool: slippage")]
    fn one_transfer_swap_respects_min_out() {
        let mut p = pool();
        let quote = p.quote_swap(0, U128(1_000_000_000)).0;
        as_("tusd.near");
        let msg = format!(r#"{{"action":"swap","min_out":"{}"}}"#, quote + 1);
        let _ = p.ft_on_transfer(acc("trader.near"), U128(1_000_000_000), msg);
    }

    fn add_in_order(usd_first: bool) {
        let mut p = pool();
        let (u, n) = (4_000_000_000u128, 1_000 * N);
        let send = |p: &mut Pool, usd: bool| {
            if usd { as_("tusd.near"); let _ = p.ft_on_transfer(acc("lp2.near"), U128(u), ADD.into()); }
            else { as_("tnear.near"); let _ = p.ft_on_transfer(acc("lp2.near"), U128(n), ADD.into()); }
        };
        send(&mut p, usd_first);
        assert_eq!(p.position_of(acc("lp2.near")).shares.0, 0, "waits for the other token");
        send(&mut p, !usd_first);
        assert!(p.position_of(acc("lp2.near")).shares.0 > 0);
        assert_eq!(p.balances_of(acc("lp2.near")), (U128(0), U128(0)), "both tokens used up at the pool ratio");
    }

    #[test]
    fn add_runs_when_tusd_arrives_first() {
        add_in_order(true);
    }

    #[test]
    fn add_runs_when_tnear_arrives_first() {
        add_in_order(false);
    }

    #[test]
    fn withdraw_all_empties_both_balances() {
        let mut p = pool();
        fund(&mut p, "t.near", 5_000_000, 7 * N);
        as_("t.near");
        p.withdraw_all();
        assert_eq!(p.balances_of(acc("t.near")), (U128(0), U128(0)));
    }
}
