//! The tokenized physical cards as NEP-171 NFTs, on top of the existing token storage (`rwa`), so tokens minted before
//! this standard layer existed keep their owners with no migration.
//!
//! - NEP-171 core: `nft_transfer`, `nft_transfer_call` (+ `nft_resolve_transfer`), `nft_token`.
//! - NEP-177 metadata: `nft_metadata`, and per-token metadata (title, image, set and number) inside `nft_token`.
//! - NEP-178 approvals: `nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`, so a marketplace can sell for a holder.
//! - NEP-181 enumeration: `nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner`.
//! - NEP-297 events: `nft_mint` when a season pack mints, `nft_transfer`, and `nft_burn` when a card is redeemed.
//!
//! Token id = the card's index in the stock, as a string ("0".."22"). A redeemed token is burned: it no longer appears in
//! any NFT view and cannot move.
use crate::*;
use near_sdk::serde_json::json;

pub const NFT_SPEC: &str = "nft-1.0.0";
const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(5);
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(25);

#[ext_contract(ext_nft_receiver)]
pub trait NonFungibleTokenReceiver {
    fn nft_on_transfer(&mut self, sender_id: AccountId, previous_owner_id: AccountId, token_id: String, msg: String) -> PromiseOrValue<bool>;
}

#[ext_contract(ext_nft_approval_receiver)]
pub trait NonFungibleTokenApprovalReceiver {
    fn nft_on_approve(&mut self, token_id: String, owner_id: AccountId, approval_id: u64, msg: String);
}

#[ext_contract(ext_self_nft)]
pub trait SelfNft {
    fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: String, approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>) -> bool;
}

/// Contract-level metadata and each token's image path, set by the owner. Images are `base_uri` + `media[token id]`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub struct NftConfig {
    pub name: String,
    pub symbol: String,
    pub base_uri: Option<String>,
    pub icon: Option<String>,
    /// One image path per token id, relative to `base_uri`.
    pub media: Vec<String>,
}

impl Default for NftConfig {
    fn default() -> Self {
        Self { name: "Cardsdotgg White Flare".into(), symbol: "CDGWF".into(), base_uri: None, icon: None, media: vec![] }
    }
}

/// Approved accounts for one token, and the next approval id to hand out (never reused for that token).
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct Approvals {
    pub next_id: u64,
    pub accounts: Vec<(AccountId, u64)>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct JsonToken {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: TokenMetadata,
    pub approved_account_ids: std::collections::HashMap<AccountId, u64>,
}

/// "SV11W 004 Cottonee" -> ("SV11W", "004", "Cottonee").
fn split_card(card: &str) -> (String, String, String) {
    let mut it = card.splitn(3, ' ');
    let set = it.next().unwrap_or("").to_string();
    let number = it.next().unwrap_or("").to_string();
    let name = it.next().unwrap_or(card).to_string();
    (set, number, name)
}

fn parse_id(token_id: &str) -> u8 {
    token_id.parse::<u8>().unwrap_or_else(|_| env::panic_str("no such token"))
}

/// NEP-297 event log.
pub fn emit(event: &str, data: near_sdk::serde_json::Value) {
    env::log_str(&format!("EVENT_JSON:{}", json!({ "standard": "nep171", "version": "1.2.0", "event": event, "data": [data] })));
}

#[near]
impl Game {
    // ------------------------------------------------------------------ NEP-177 metadata

    pub fn nft_metadata(&self) -> NftContractMetadata {
        let c = Self::nft_config();
        NftContractMetadata { spec: NFT_SPEC.into(), name: c.name, symbol: c.symbol, icon: c.icon, base_uri: c.base_uri, reference: None, reference_hash: None }
    }

    /// Owner only: where the card images live (e.g. the app's URL) and each token's image path under it.
    pub fn set_nft_config(&mut self, base_uri: Option<String>, media: Vec<String>, icon: Option<String>) {
        self.assert_owner();
        require!(media.len() == Self::rwa_stock_of().cards.len(), "one image path per card in the stock");
        let mut c = Self::nft_config();
        c.base_uri = base_uri;
        c.media = media;
        c.icon = icon;
        let mut map = LookupMap::<u8, NftConfig>::new(b"n");
        map.insert(0, c);
        map.flush();
    }

    /// Owner only, once: log `nft_mint` for tokens minted before the NFT layer existed, so indexers and wallets see them.
    pub fn nft_backfill_mint_events(&mut self) {
        self.assert_owner();
        for t in self.live_tokens() {
            emit("nft_mint", json!({ "owner_id": t.1.owner, "token_ids": [t.0.to_string()] }));
        }
    }

    // ------------------------------------------------------------------ NEP-171 core

    pub fn nft_token(&self, token_id: String) -> Option<JsonToken> {
        let id = token_id.parse::<u8>().ok()?;
        let t = Self::rwa_tokens().get(&id).cloned().filter(|t| !t.redeemed)?;
        Some(self.json_token(id, &t))
    }

    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires an attached deposit of exactly 1 yoctoNEAR");
        self.nft_move(&env::predecessor_account_id(), &receiver_id, &token_id, approval_id, memo);
    }

    #[payable]
    pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires an attached deposit of exactly 1 yoctoNEAR");
        require!(env::prepaid_gas() > GAS_FOR_ON_TRANSFER.saturating_add(GAS_FOR_RESOLVE).saturating_add(Gas::from_tgas(10)), "more gas is required");
        let sender = env::predecessor_account_id();
        let (previous_owner, old_approvals) = self.nft_move(&sender, &receiver_id, &token_id, approval_id, memo);
        ext_nft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_ON_TRANSFER)
            .nft_on_transfer(sender, previous_owner.clone(), token_id.clone(), msg)
            .then(ext_self_nft::ext(env::current_account_id()).with_static_gas(GAS_FOR_RESOLVE).nft_resolve_transfer(previous_owner, receiver_id, token_id, Some(old_approvals)))
            .into()
    }

    /// After `nft_transfer_call`: if the receiver asked for the token back (or failed), return it to the previous owner.
    /// Returns true when the token stays with the receiver.
    #[private]
    pub fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: String, approved_account_ids: Option<std::collections::HashMap<AccountId, u64>>, #[callback_result] must_return: Result<bool, PromiseError>) -> bool {
        if let Ok(false) = must_return {
            return true;
        }
        let id = parse_id(&token_id);
        let mut tokens = Self::rwa_tokens();
        let Some(mut t) = tokens.get(&id).cloned() else { return true };
        if t.owner != receiver_id || t.redeemed {
            return true; // it already moved on, or was redeemed: nothing to return
        }
        t.owner = previous_owner_id.clone();
        tokens.insert(id, t);
        tokens.flush();
        let mut ap = Self::approvals_of(id);
        ap.accounts = approved_account_ids.unwrap_or_default().into_iter().collect();
        Self::approvals_put(id, &ap);
        emit("nft_transfer", json!({ "old_owner_id": receiver_id, "new_owner_id": previous_owner_id, "token_ids": [token_id] }));
        false
    }

    // ------------------------------------------------------------------ NEP-178 approvals

    #[payable]
    pub fn nft_approve(&mut self, token_id: String, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        require!(env::attached_deposit() >= NearToken::from_yoctonear(1), "requires an attached deposit to cover storage");
        let id = parse_id(&token_id);
        let t = self.live_token(id);
        require!(t.owner == env::predecessor_account_id(), "not the token holder");
        let before = env::storage_usage();
        let mut ap = Self::approvals_of(id);
        let approval_id = ap.next_id;
        ap.next_id += 1;
        ap.accounts.retain(|(a, _)| a != &account_id);
        ap.accounts.push((account_id.clone(), approval_id));
        Self::approvals_put(id, &ap);
        let used = env::storage_usage().saturating_sub(before) as u128;
        let cost = env::storage_byte_cost().saturating_mul(used);
        require!(env::attached_deposit() >= cost, format!("attach at least {} yoctoNEAR for storage", cost.as_yoctonear()));
        let refund = env::attached_deposit().saturating_sub(cost);
        if refund.as_yoctonear() > 1 {
            let _ = Promise::new(env::predecessor_account_id()).transfer(refund);
        }
        msg.map(|m| ext_nft_approval_receiver::ext(account_id).nft_on_approve(token_id, t.owner, approval_id, m))
    }

    #[payable]
    pub fn nft_revoke(&mut self, token_id: String, account_id: AccountId) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires an attached deposit of exactly 1 yoctoNEAR");
        let id = parse_id(&token_id);
        require!(self.live_token(id).owner == env::predecessor_account_id(), "not the token holder");
        let mut ap = Self::approvals_of(id);
        ap.accounts.retain(|(a, _)| a != &account_id);
        Self::approvals_put(id, &ap);
    }

    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: String) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires an attached deposit of exactly 1 yoctoNEAR");
        let id = parse_id(&token_id);
        require!(self.live_token(id).owner == env::predecessor_account_id(), "not the token holder");
        let mut ap = Self::approvals_of(id);
        ap.accounts.clear();
        Self::approvals_put(id, &ap);
    }

    pub fn nft_is_approved(&self, token_id: String, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        let Ok(id) = token_id.parse::<u8>() else { return false };
        Self::approvals_of(id).accounts.iter().any(|(a, n)| *a == approved_account_id && approval_id.map_or(true, |x| x == *n))
    }

    // ------------------------------------------------------------------ NEP-181 enumeration

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.live_tokens().len() as u128)
    }

    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<JsonToken> {
        let from = from_index.map_or(0, |x| x.0 as usize);
        self.live_tokens().into_iter().skip(from).take(limit.unwrap_or(50) as usize).map(|(id, t)| self.json_token(id, &t)).collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.live_tokens().iter().filter(|(_, t)| t.owner == account_id).count() as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<JsonToken> {
        let from = from_index.map_or(0, |x| x.0 as usize);
        self.live_tokens()
            .into_iter()
            .filter(|(_, t)| t.owner == account_id)
            .skip(from)
            .take(limit.unwrap_or(50) as usize)
            .map(|(id, t)| self.json_token(id, &t))
            .collect()
    }
}

impl Game {
    fn nft_config() -> NftConfig {
        LookupMap::<u8, NftConfig>::new(b"n").get(&0).cloned().unwrap_or_default()
    }

    /// Approvals live under prefix "z" (token id).
    fn approvals_map() -> LookupMap<u8, Approvals> {
        LookupMap::new(b"z")
    }

    pub(crate) fn approvals_of(id: u8) -> Approvals {
        Self::approvals_map().get(&id).cloned().unwrap_or_default()
    }

    pub(crate) fn approvals_put(id: u8, ap: &Approvals) {
        let mut map = Self::approvals_map();
        map.insert(id, ap.clone());
        map.flush();
    }

    /// Minted, not redeemed tokens in id order.
    fn live_tokens(&self) -> Vec<(u8, rwa::Token)> {
        let tokens = Self::rwa_tokens();
        (0..Self::rwa_stock_of().total()).filter_map(|i| tokens.get(&i).cloned().filter(|t| !t.redeemed).map(|t| (i, t))).collect()
    }

    fn live_token(&self, id: u8) -> rwa::Token {
        let t = Self::rwa_tokens().get(&id).cloned().unwrap_or_else(|| env::panic_str("no such token"));
        require!(!t.redeemed, "this token was redeemed");
        t
    }

    fn json_token(&self, id: u8, t: &rwa::Token) -> JsonToken {
        let stock = Self::rwa_stock_of();
        let cfg = Self::nft_config();
        let card = stock.cards.get(id as usize).cloned().unwrap_or_default();
        let (set, number, name) = split_card(&card);
        JsonToken {
            token_id: id.to_string(),
            owner_id: t.owner.clone(),
            metadata: TokenMetadata {
                title: Some(format!("{name} · {set} {number}")),
                description: Some(format!("One real {name} card ({set} {number}), held in the Cardsdotgg vault and tokenized one of one.")),
                media: cfg.media.get(id as usize).cloned(),
                media_hash: None,
                copies: Some(1),
                issued_at: Some((t.minted_at * 1000).to_string()),
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: Some(json!({ "set": set, "number": number, "card": card, "physical": true }).to_string()),
                reference: None,
                reference_hash: None,
            },
            approved_account_ids: Self::approvals_of(id).accounts.into_iter().collect(),
        }
    }

    /// Move a token from its holder to `receiver`, by the holder or an approved account. Clears approvals and logs
    /// `nft_transfer`. Returns the previous owner and the approvals it had (for `nft_resolve_transfer`).
    fn nft_move(&mut self, sender: &AccountId, receiver: &AccountId, token_id: &str, approval_id: Option<u64>, memo: Option<String>) -> (AccountId, std::collections::HashMap<AccountId, u64>) {
        let id = parse_id(token_id);
        let mut t = self.live_token(id);
        let ap = Self::approvals_of(id);
        let authorized = if *sender == t.owner {
            None
        } else {
            let n = ap.accounts.iter().find(|(a, _)| a == sender).map(|(_, n)| *n);
            require!(n.is_some(), "not the token holder or an approved account");
            if let Some(want) = approval_id {
                require!(Some(want) == n, "approval id does not match");
            }
            Some(sender.clone())
        };
        require!(*receiver != t.owner, "the token holder and receiver must differ");
        let previous = t.owner.clone();
        t.owner = receiver.clone();
        let mut tokens = Self::rwa_tokens();
        tokens.insert(id, t);
        tokens.flush();
        let old: std::collections::HashMap<AccountId, u64> = ap.accounts.iter().cloned().collect();
        Self::approvals_put(id, &Approvals { next_id: ap.next_id, accounts: vec![] });
        let mut ev = json!({ "old_owner_id": previous, "new_owner_id": receiver, "token_ids": [token_id] });
        if let Some(a) = authorized {
            ev["authorized_id"] = json!(a);
        }
        if let Some(m) = memo {
            ev["memo"] = json!(m);
        }
        emit("nft_transfer", ev);
        (previous, old)
    }
}
