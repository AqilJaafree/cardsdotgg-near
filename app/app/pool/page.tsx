"use client";
import { useState } from "react";
import { TxButton } from "@/components/TxButton";
import { GameScreen } from "@/components/game/GameScreen";
import { A, fmtNear, fmtUsd, liq, parseAmount, rateSources } from "@/lib/contracts";
import type { CallArgs } from "@/lib/wallet";
import { useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";
import { ONE_YOCTO, TGAS } from "@/lib/near";

const SHARE_DECIMALS = 15; // sqrt of 6 + 24 token decimals
const u = (v: bigint, d: number) => (Number(v) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: 4 });
const slipMin = (v: bigint, slip: string) => (v * BigInt(Math.round((100 - Number(slip || 0)) * 100))) / 10000n;
const pair = (v?: [string, string]): [bigint, bigint] => (v ? [BigInt(v[0]), BigInt(v[1])] : [0n, 0n]);

function PriceSource() {
  if (liq.live !== true) return null;
  const price = (Number(liq.usdPerNear1e6) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return (
    <details className="gs-more">
      <summary>Where do the prices come from?</summary>
      <p>The game reads real prices from <a href={String(liq.sourceUrl)} target="_blank" rel="noreferrer">Rhea</a> (a NEAR exchange). NEAR is about ${price} right now. This swap pool uses test coins, so its own price moves only when people swap here.</p>
      {rateSources.map((r) => (
        <p key={r.tier} className="gs-note"><b>{["Guardian", "Balanced", "Degen"][Number(r.tier)]}</b>: about {(r.bps / 100).toFixed(1)}% a year, from <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.source}</a></p>
      ))}
    </details>
  );
}

export default function Pool() {
  const { accountId } = useWallet();
  const pool = A.pool;
  const slip = "1"; // the price may move 1% between asking and paying
  const [tusd, setTusd] = useState("100");
  const [near, setNear] = useState("25");
  const [swapAsset, setSwapAsset] = useState(0);
  const [swapIn, setSwapIn] = useState("10");
  const [shares, setShares] = useState("");
  const me = accountId ? { account_id: accountId } : undefined;
  const rv = useView<[string, string]>(pool, "reserves", {}, { interval: 6000 });
  const bal = useView<[string, string]>(pool, "balances_of", me, { enabled: !!me, interval: 6000 });
  const pos = useView<{ shares: string; tusd: string; tnear: string }>(pool, "position_of", me, { enabled: !!me, interval: 6000 });
  const wallet = (token: string) => useView<string>(token, "ft_balance_of", me, { enabled: !!me, interval: 6000 });
  const wT = wallet(A.tusd), wN = wallet(A.tnear);
  const [rT, rN] = pair(rv.data);
  const [bT, bN] = pair(bal.data);
  const pS = BigInt(pos.data?.shares ?? 0), pT = BigInt(pos.data?.tusd ?? 0), pN = BigInt(pos.data?.tnear ?? 0);
  const tIn = parseAmount(tusd, 6), nIn = parseAmount(near, 24);
  // The pool takes tokens at its own ratio, so send exactly the matching amounts and nothing is left over.
  const nOptimal = rT > 0n ? (tIn * rN) / rT : nIn;
  const [useT, useN] = nOptimal <= nIn ? [tIn, nOptimal] : [rN > 0n ? (nIn * rT) / rN : tIn, nIn];
  const sAmt = parseAmount(swapIn, swapAsset === 0 ? 6 : 24);
  const quote = useView<string>(pool, "quote_swap", { asset_in: swapAsset, amount_in: sAmt.toString() }, { enabled: sAmt > 0n && rT > 0n });
  const out = BigInt(quote.data ?? 0);
  const refetch = () => { rv.refetch(); bal.refetch(); pos.refetch(); wT.refetch(); wN.refetch(); };
  const shAmt = parseAmount(shares, SHARE_DECIMALS);
  const rmT = pS > 0n ? (pT * shAmt) / pS : 0n, rmN = pS > 0n ? (pN * shAmt) / pS : 0n;
  const haveSwap = BigInt((swapAsset === 0 ? wT.data : wN.data) ?? 0) >= sAmt;
  const haveAdd = BigInt(wT.data ?? 0) >= useT && BigInt(wN.data ?? 0) >= useN && useT > 0n && useN > 0n;
  const transfer = (token: string, amount: bigint, msg: string): CallArgs => ({ receiverId: token, methodName: "ft_transfer_call", gas: TGAS(100), deposit: ONE_YOCTO, args: { receiver_id: pool, amount: amount.toString(), msg } });
  const addMsg = JSON.stringify({ action: "add", tusd_min: slipMin(useT, slip).toString(), tnear_min: slipMin(useN, slip).toString() });
  const swapMsg = JSON.stringify({ action: "swap", min_out: slipMin(out, slip).toString() });
  const price = rT > 0n ? Number(rT) / 1e6 / (Number(rN) / 1e24) : 0;
  return (
    <GameScreen title="SWAP">
      <section className="qm-card gs-card">
        <h2>Swap coins</h2>
        <p>Trade your free test coins. 1 tNEAR ≈ {price ? price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "…"} tUSD right now.</p>
        <div className="gs-stat"><span>You have</span><b>{fmtUsd(BigInt(wT.data ?? 0))} tUSD · {fmtNear(BigInt(wN.data ?? 0))} tNEAR</b></div>
        <div className="gs-choices two">
          <button className={`gs-choice ${swapAsset === 0 ? "on" : ""}`} onClick={() => setSwapAsset(0)}>tUSD → tNEAR</button>
          <button className={`gs-choice ${swapAsset === 1 ? "on" : ""}`} onClick={() => setSwapAsset(1)}>tNEAR → tUSD</button>
        </div>
        <input value={swapIn} onChange={(e) => setSwapIn(e.target.value)} inputMode="decimal" aria-label="Amount to swap" />
        <div className="gs-stat"><span>You get about</span><b>{swapAsset === 0 ? fmtNear(out) + " tNEAR" : fmtUsd(out) + " tUSD"}</b></div>
        <TxButton label="SWAP" disabled={sAmt === 0n || out === 0n || !haveSwap} onConfirmed={() => { refetch(); quote.refetch(); }}
          request={transfer(swapAsset === 0 ? A.tusd : A.tnear, sAmt, swapMsg)} />
        {!haveSwap && sAmt > 0n && <p className="gs-note">You don't have enough of that coin. Claim more on the GET COINS tab.</p>}
        <PriceSource />
      </section>

      <section className="qm-card gs-card">
        <details className="gs-more" style={{ borderTop: 0, paddingTop: 0 }}>
          <summary>Pool tools (optional)</summary>
          <p className="gs-note">Add your coins to the swap pool and earn a share of the swap fees. Fees stay in the pool until you take your coins out.</p>
          <div className="gs-stat"><span>Your share of the pool</span><b>{fmtUsd(pT)} tUSD + {fmtNear(pN)} tNEAR</b></div>
          <h3>Add to the pool</h3>
          <input value={tusd} onChange={(e) => setTusd(e.target.value)} inputMode="decimal" aria-label="tUSD to add" />
          <input value={near} onChange={(e) => setNear(e.target.value)} inputMode="decimal" aria-label="tNEAR to add" />
          <p className="gs-note">This adds {fmtUsd(useT)} tUSD and {fmtNear(useN)} tNEAR at the pool's price.</p>
          <TxButton label="ADD TO POOL" disabled={!haveAdd} onConfirmed={refetch}
            request={[transfer(A.tusd, useT, addMsg), transfer(A.tnear, useN, addMsg)]} />
          <h3>Take your coins out</h3>
          <input placeholder="How much of your share (shares)" value={shares} onChange={(e) => setShares(e.target.value)} aria-label="Shares to remove" />
          <button className="gs-mini" onClick={() => setShares((Number(pS) / 10 ** SHARE_DECIMALS).toFixed(SHARE_DECIMALS))}>TAKE ALL</button>
          <p className="gs-note">You get about {fmtUsd(rmT)} tUSD + {fmtNear(rmN)} tNEAR, sent to your wallet.</p>
          <TxButton label="TAKE OUT" disabled={shAmt === 0n || shAmt > pS} onConfirmed={refetch}
            request={{ receiverId: pool, methodName: "remove_liquidity", gas: TGAS(50), args: { shares: shAmt.toString(), tusd_min: slipMin(rmT, slip).toString(), tnear_min: slipMin(rmN, slip).toString() },
              then: [{ methodName: "withdraw_all", gas: TGAS(80), args: {} }] }} />
        </details>
      </section>

      {(bT > 0n || bN > 0n) && (
        <section className="qm-card gs-card">
          <h2>Coins waiting for you</h2>
          <p>{fmtUsd(bT)} tUSD + {fmtNear(bN)} tNEAR are waiting in the pool (this happens if a swap didn't go through).</p>
          <TxButton label="SEND TO MY WALLET" onConfirmed={refetch} request={{ receiverId: pool, methodName: "withdraw_all", gas: TGAS(80), args: {} }} />
        </section>
      )}
    </GameScreen>
  );
}
