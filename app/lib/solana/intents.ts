// NEAR Intents (1Click API, mainnet): pay in NEAR, receive SOL or USDC on a Solana wallet. Public, no API key.
// Docs: https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote

const ONECLICK = "https://1click.chaindefuser.com/v0";
/** What the player pays with: NEAR, wrapped to wNEAR in the same transaction. */
export const ORIGIN = "nep141:wrap.near";
/** What lands on Solana, by the listing's currency. */
export const DEST = {
  SOL: { asset: "nep141:sol.omft.near", decimals: 9 },
  USDC: { asset: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6 },
} as const;
/**
 * Delivered on top of the asking price, so the buy on the marketplace covers its fees (Magic Eden's taker fee and
 * royalties, Collector Crypt's buyer fee) and, for SOL, the network fee. Anything left stays in the player's wallet.
 */
export const FEE_BUFFER = 0.05;

export type Quote = {
  depositAddress?: string;
  amountIn: string; amountInFormatted: string; amountInUsd: string;
  amountOut: string; amountOutFormatted: string; amountOutUsd: string;
  timeEstimate: number;
};

export const isSolanaAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());

/** Price plus the fee buffer, in the destination token's base units, rounded up. */
export function deliverAmount(price: number, currency: keyof typeof DEST): string {
  const d = DEST[currency].decimals;
  return BigInt(Math.ceil(price * (1 + FEE_BUFFER) * 10 ** d)).toString();
}

/**
 * Ask 1Click how much NEAR delivers `price` (+ buffer) of `currency` to `recipient` on Solana. `dry` quotes are
 * previews; a live quote returns the NEAR `depositAddress` to send wNEAR to.
 */
export async function quote(o: { price: number; currency: keyof typeof DEST; recipient: string; refundTo: string; dry: boolean }): Promise<Quote> {
  const res = await fetch(`${ONECLICK}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: o.dry, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
      originAsset: ORIGIN, depositType: "ORIGIN_CHAIN",
      destinationAsset: DEST[o.currency].asset, amount: deliverAmount(o.price, o.currency),
      refundTo: o.refundTo, refundType: "ORIGIN_CHAIN",
      recipient: o.recipient.trim(), recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 20 * 60_000).toISOString(),
    }),
  });
  const d = await res.json();
  if (!res.ok || !d.quote) throw new Error(d.message ?? `NEAR Intents quote failed (${res.status})`);
  return d.quote as Quote;
}

/** Tell 1Click about the deposit transaction so it starts at once (optional; it also watches the address). */
export async function submitDeposit(txHash: string, depositAddress: string) {
  await fetch(`${ONECLICK}/deposit/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash, depositAddress }) }).catch(() => {});
}

export type SwapStatus = "PENDING_DEPOSIT" | "KNOWN_DEPOSIT_TX" | "PROCESSING" | "SUCCESS" | "INCOMPLETE_DEPOSIT" | "REFUNDED" | "FAILED";

export async function status(depositAddress: string): Promise<SwapStatus> {
  const res = await fetch(`${ONECLICK}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
  const d = await res.json().catch(() => ({}));
  return (d.status ?? "PENDING_DEPOSIT") as SwapStatus;
}

/** Live token prices (USD) from 1Click, for showing an estimated NEAR price before a quote. */
export async function usdPrices(): Promise<{ near: number; sol: number; usdc: number }> {
  const t = (await (await fetch(`${ONECLICK}/tokens`)).json()) as { assetId: string; price: number }[];
  const p = (id: string) => t.find((x) => x.assetId === id)?.price ?? 0;
  return { near: p(ORIGIN), sol: p(DEST.SOL.asset), usdc: p(DEST.USDC.asset) || 1 };
}
