/** Rhea (formerly Ref Finance) on NEAR mainnet. Pool data comes from its indexer; reserves are cross-checked over RPC. */
export const RHEA_DEX_CONTRACT = "v2.ref-finance.near";
export const RHEA_POOL_SEARCH = "https://indexer.ref.finance/proxy/pool/search";
export const RHEA_TOKEN_PRICES = "https://indexer.ref.finance/list-token-price";
export const NEAR_MAINNET_RPC = "https://rpc.mainnet.near.org";
export const WNEAR = "wrap.near";
export const RHEA_POOL_URL = (id: string | number) => `https://app.rhea.finance/sauce/${id}`;

/** One Rhea pool per deck tier. Guardian is a stable pool, Balanced a blue-chip pair, Degen the volatile RHEA/wNEAR pair. */
export const TIER_POOLS = [
  { tier: 0, poolId: "4179", why: "Rated stable pool (USDt/USDC/USDT.e/USDC.e)" },
  { tier: 1, poolId: "4512", why: "USDC/wNEAR, the deepest NEAR pool" },
  { tier: 2, poolId: "6458", why: "RHEA/wNEAR, volatile governance-token pair" },
] as const;

/** The testnet pool opens at the price and depth of this mainnet pool (NEAR priced in USDC). */
export const NEAR_REFERENCE_POOL = "4512";
