/** Oracle clamp, 0 to 50% APR. */
export function clampBps(bps: number): number {
  return Math.min(Math.max(bps, 0), 5000);
}

/** Rhea reports `apy` as a percent string. Fee APR from 24h fee volume is the fallback, annualized from one day. */
export function aprBps(row: { apy?: string; fee_volume_24h?: string; tvl: string }): number {
  const apy = Number(row.apy);
  if (Number.isFinite(apy) && apy > 0) return Math.floor(apy * 100);
  const fees = Number(row.fee_volume_24h), tvl = Number(row.tvl);
  if (!(tvl > 0) || !Number.isFinite(fees)) return 0;
  return Math.floor((fees * 365 * 10_000) / tvl);
}

/** Rejects a bad read before it reaches the oracle. Bounds are USD per whole NEAR, in 1e6 units. */
export function assertSaneNear(price1e6: bigint): void {
  if (price1e6 < 200_000n || price1e6 > 100_000_000n) throw new Error(`NEAR price out of range: ${price1e6}`);
}

/** USD per whole NEAR in 1e6 units from a USDC/wNEAR pool's reserves (6 and 24 decimals). */
export function nearPriceFromReserves(usdcRaw: bigint, wnearRaw: bigint): bigint {
  return (usdcRaw * 10n ** 24n) / wnearRaw;
}
