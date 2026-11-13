// Addresses and data come only from ../shared via scripts/sync-shared.mjs.
import liqJson from "./shared/liquidity-source.json";
import addressesJson from "./shared/addresses.json";
import cardsJson from "./shared/cards.json";
import rateSourcesJson from "./shared/rate-sources.json";

export const A = addressesJson as unknown as { game: string; tusd: string; tnear: string; pool: string; network: string; owner: string };
export const deployed = !!A.game;
export type Card = { id: number; tier: number; name: string; assetClass: string; hp: number; atk: number; def: number; spd: number; ability: string; rule: string; implemented: boolean };
export const cards = (cardsJson as { cards: Card[] }).cards;
export type RateSource = { tier: number; bps: number; live: boolean; source: string; sourceUrl: string; sourceContract?: string; note?: string; poolId?: string; tvlUsd?: number; volume24hUsd?: number; readAt: string };
export const rateSources = rateSourcesJson as RateSource[];
export const TIERS = ["Guardian", "Balanced", "Degen"];
export const ASSETS = ["tUSD", "tNEAR"];
export const STATUS = ["Open", "Awaiting seed", "In play", "Resolved", "Expired"];
export const NEAR_DECIMALS = 24;
export const liq = liqJson as Record<string, string | number | boolean>;

const num = (v: bigint, d: number) => Number(v) / 10 ** d;
export const fmtUsd = (v: bigint) => num(v, 6).toLocaleString(undefined, { maximumFractionDigits: 4 });
export const fmtNear = (v: bigint) => num(v, NEAR_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 4 });
export const fmtAmount = (asset: number, v: bigint) => (asset === 0 ? fmtUsd(v) : fmtNear(v));
export const tokenOf = (asset: number) => (asset === 0 ? A.tusd : A.tnear);

/** Exact decimal string to base units, without float rounding. Returns 0n on bad input. */
export function parseAmount(s: string, decimals: number): bigint {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return 0n;
  const [i, f = ""] = t.split(".");
  return BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

// Contract JSON views
export type DeckJson = { id: string; owner: string; tier: number; asset: number; principal: string; deposit_value_usd: string; deposited_at: string; retired: boolean; available: string; locked: string; seeded: string };
export type MatchJson = { id: string; deck_a: string; deck_b: string; player_a: string; player_b: string | null; opponent: string | null; stake_a: string; stake_b: string; seed: string | null; status: number; created_at: string; seed_block: string; winner: string | null };
export type OracleJson = { rates_bps: [number, number, number]; last_update: string; stale: boolean; source_block: string; usd_per_near_1e6: string };
