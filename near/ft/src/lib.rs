//! Testnet NEP-141 token with a public drip, once per 24 hours per account. Deployed twice: tUSD (6 decimals) and
//! tNEAR (24 decimals). The owner can mint, to fund the reserve and liquidity.
use near_contract_standards::fungible_token::metadata::{FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC};
use near_contract_standards::fungible_token::{FungibleToken, FungibleTokenCore, FungibleTokenResolver};
use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds, StorageManagement};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue};

const DAY_SECS: u64 = 24 * 3600;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TestToken {
    token: FungibleToken,
    name: String,
    symbol: String,
    decimals: u8,
    drip: u128,
    owner: AccountId,
    last_claim: LookupMap<AccountId, u64>,
}

fn now() -> u64 {
    env::block_timestamp() / 1_000_000_000
}

#[near]
impl TestToken {
    #[init]
    pub fn new(owner: AccountId, name: String, symbol: String, decimals: u8, drip: U128) -> Self {
        Self { token: FungibleToken::new(b"t"), name, symbol, decimals, drip: drip.0, owner, last_claim: LookupMap::new(b"c") }
    }

    /// Public drip. Registers the caller's storage on first use (the token account pays, it is a testnet token).
    pub fn claim(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        let t = now();
        if let Some(last) = self.last_claim.get(&who) {
            require!(t >= last + DAY_SECS, "claim: wait 24h");
        }
        self.last_claim.insert(who.clone(), t);
        self.mint_to(&who, self.drip);
        U128(self.drip)
    }

    /// Unix seconds when `account_id` can claim again; 0 means now.
    pub fn next_claim_at(&self, account_id: AccountId) -> U64 {
        match self.last_claim.get(&account_id) {
            Some(last) if now() < last + DAY_SECS => U64(last + DAY_SECS),
            _ => U64(0),
        }
    }

    pub fn drip(&self) -> U128 {
        U128(self.drip)
    }

    /// Owner only.
    pub fn mint(&mut self, to: AccountId, amount: U128) {
        require!(env::predecessor_account_id() == self.owner, "owner only");
        self.mint_to(&to, amount.0);
    }
}

impl TestToken {
    fn mint_to(&mut self, who: &AccountId, amount: u128) {
        if !self.token.accounts.contains_key(who) {
            self.token.internal_register_account(who);
        }
        self.token.internal_deposit(who, amount);
    }
}

#[near]
impl FungibleTokenCore for TestToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for TestToken {
    #[private]
    fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let (used, _burned) = self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        used.into()
    }
}

#[near]
impl StorageManagement for TestToken {
    #[payable]
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.internal_storage_unregister(force).is_some()
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for TestToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: self.decimals,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    fn ctx(who: &str, secs: u64) {
        testing_env!(VMContextBuilder::new().predecessor_account_id(who.parse().unwrap()).block_timestamp(secs * 1_000_000_000).build());
    }

    #[test]
    fn claim_once_per_24h() {
        ctx("owner.near", 1000);
        let mut t = TestToken::new("owner.near".parse().unwrap(), "Test USD".into(), "tUSD".into(), 6, U128(1_000_000_000));
        ctx("alice.near", 1000);
        t.claim();
        let alice: AccountId = "alice.near".parse().unwrap();
        assert_eq!(t.ft_balance_of(alice.clone()).0, 1_000_000_000);
        assert_eq!(t.next_claim_at(alice.clone()).0, 1000 + DAY_SECS);
        ctx("alice.near", 1000 + DAY_SECS);
        t.claim();
        assert_eq!(t.ft_balance_of(alice).0, 2_000_000_000);
    }

    #[test]
    #[should_panic(expected = "claim: wait 24h")]
    fn second_claim_too_early_fails() {
        ctx("owner.near", 1000);
        let mut t = TestToken::new("owner.near".parse().unwrap(), "t".into(), "t".into(), 6, U128(1));
        ctx("alice.near", 1000);
        t.claim();
        ctx("alice.near", 1000 + DAY_SECS - 1);
        t.claim();
    }
}
