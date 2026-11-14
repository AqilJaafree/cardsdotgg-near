"use client";
import { useEffect, useState } from "react";
import { Award, ExternalLink, RefreshCw, Wallet, Zap } from "lucide-react";
import { isCancel, readable } from "@/components/TxButton";
import { collectorCryptCheapest, magicEdenCheapest, type SolListing } from "@/lib/solana/listings";
import { FEE_BUFFER, isSolanaAddress, quote, status, submitDeposit, usdPrices, type Quote, type SwapStatus } from "@/lib/solana/intents";
import { useMainnetWallet } from "@/lib/solana/mainnetWallet";

const SOURCES = { CC: "Collector Crypt", ME: "Magic Eden" } as const;
const WALLET_KEY = "cardsdotgg.solana-recipient";
type Usd = { near: number; sol: number; usdc: number };
/** A listing's asking price in USD (listings are priced in USDC or SOL). */
const usdOf = (l: SolListing, u: Usd | null) => (u ? l.price * (l.currency === "SOL" ? u.sol : u.usdc) : null);
const money = (n: number | null) => (n == null ? "…" : `$${n.toFixed(2)}`);

/** The cheapest graded Pokémon cards for sale: 5 from Collector Crypt and 5 from Magic Eden, cheapest first. */
export function useGradedCards() {
  const [cards, setCards] = useState<SolListing[] | null>(null), [failed, setFailed] = useState(false), [usd, setUsd] = useState<Usd | null>(null);
  useEffect(() => {
    let live = true;
    usdPrices().then((u) => live && setUsd(u)).catch(() => {});
    Promise.allSettled([collectorCryptCheapest(), magicEdenCheapest()]).then((r) => {
      if (!live) return;
      const ok = r.flatMap((x) => (x.status === "fulfilled" ? x.value : []));
      setFailed(ok.length === 0); setCards(ok);
    });
    return () => { live = false; };
  }, []);
  return { cards, failed, usd };
}

/** One graded card as a market tile, in the same style as the packs. */
export function GradedTile({ l, usd, onBuy }: { l: SolListing; usd: Usd | null; onBuy: () => void }) {
  const price = usdOf(l, usd), near = price != null && usd?.near ? (price * (1 + FEE_BUFFER)) / usd.near : null;
  return <section className="qm-card gs-card mk-item mk-graded">
    <span className="arc-tag graded"><Award size={12} />GRADED CARD</span>
    <a className="mk-art" href={l.url} target="_blank" rel="noreferrer" aria-label={`${l.name} on ${SOURCES[l.source]}`}><img src={l.image} alt={l.name} loading="lazy" /></a>
    <h2 title={l.name}>{l.name.replace(/\s+Pokemon$/i, "")}</h2>
    <p>{[l.grade, SOURCES[l.source]].filter(Boolean).join(" · ")}</p>
    <span className="mk-cost"><Zap size={14} />{money(price)}{near ? ` · ≈ ${near.toFixed(2)} NEAR` : ""}</span>
    <button className="cm-btn cm-market qm-btn mk-btn" onClick={onBuy}>BUY WITH NEAR</button>
  </section>;
}

type Step = "setup" | "quoting" | "review" | "paying" | "swapping" | "arrived" | "refunded";

/** Pay with NEAR on mainnet → NEAR Intents delivers the price (+ fees) to the card wallet → buy on the marketplace. */
export function BuySheet({ listing: l, usd, onClose }: { listing: SolListing; usd: Usd | null; onClose: () => void }) {
  const near = useMainnetWallet();
  const [sol, setSol] = useState(() => { try { return localStorage.getItem(WALLET_KEY) ?? ""; } catch { return ""; } });
  const [step, setStep] = useState<Step>("setup"), [q, setQ] = useState<Quote | null>(null), [err, setErr] = useState(""), [st, setSt] = useState<SwapStatus | null>(null);
  const solOk = isSolanaAddress(sol);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && step !== "paying" && step !== "swapping") onClose(); };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [onClose, step]);

  async function getQuote() {
    setErr(""); setStep("quoting");
    try {
      const id = near.accountId ?? (await near.connect());
      if (!id) throw new Error("Connect your NEAR mainnet wallet first");
      try { localStorage.setItem(WALLET_KEY, sol.trim()); } catch { /* fine */ }
      setQ(await quote({ price: l.price, currency: l.currency, recipient: sol, refundTo: id, dry: false }));
      setStep("review");
    } catch (e) {
      const m = (e as Error)?.message ?? String(e);
      setErr(isCancel(m) ? "" : readable(m)); setStep("setup");
    }
  }

  async function pay() {
    if (!q?.depositAddress) return;
    setErr(""); setStep("paying");
    let hash: string | undefined;
    try { hash = await near.payIntent(q.depositAddress, q.amountIn); }
    catch (e) {
      // Some wallets report "closed" even after sending: watch the swap below before deciding it was cancelled.
      const m = (e as Error)?.message ?? String(e);
      if (!isCancel(m)) { setErr(readable(m)); setStep("review"); return; }
    }
    if (hash) submitDeposit(hash, q.depositAddress);
    setStep("swapping");
    for (let i = 0; i < 90; i++) {                     // up to ~3 minutes
      const s = await status(q.depositAddress).catch(() => null);
      if (s) setSt(s);
      if (s === "SUCCESS") { setStep("arrived"); return; }
      if (s === "REFUNDED" || s === "FAILED") { setStep("refunded"); return; }
      if (i === 6 && (s === "PENDING_DEPOSIT" || !s) && !hash) { setErr("You closed the wallet, so nothing was sent."); setStep("review"); return; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setErr("Still processing. Your funds are safe: check your card wallet in a few minutes.");
  }

  const busy = step === "quoting" || step === "paying" || step === "swapping";
  return <div className="arc-sheet" role="dialog" aria-modal="true" aria-label={`Buy ${l.name}`} onClick={() => !busy && onClose()}>
    <section className="qm-card gs-card sm-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="sm-sheet-top"><img src={l.image} alt="" /><div><b>{l.name}</b><span className="sm-grade">{l.grade}</span><span className="sm-price">{money(usdOf(l, usd))} on {SOURCES[l.source]}</span></div></div>

      {(step === "setup" || step === "quoting") && <>
        <ol className="sm-steps">
          <li>Pay with <b>NEAR on mainnet</b> (real NEAR).</li>
          <li>NEAR Intents sends <b>{money(usdOf(l, usd))} + {FEE_BUFFER * 100}%</b> for marketplace fees to your card wallet, in about 20 seconds.</li>
          <li>Buy the card on {SOURCES[l.source]} with that wallet.</li>
        </ol>
        <label className="sm-field">Your card wallet address
          <input value={sol} onChange={(e) => setSol(e.target.value)} placeholder="Your Phantom or Solflare address" spellCheck={false} autoComplete="off" />
        </label>
        {sol && !solOk && <p className="pack-note bad">That does not look like a wallet address.</p>}
        <p className="sm-acct"><Wallet size={14} />{near.accountId ? <>NEAR mainnet: <b>{near.accountId}</b> <button className="sm-link" onClick={near.disconnect}>switch</button></> : "Your NEAR mainnet wallet connects on the next step."}</p>
        <button className="cm-btn cm-play qm-btn" disabled={!solOk || busy} onClick={getQuote}>{step === "quoting" ? "GETTING PRICE…" : near.accountId ? "GET PRICE" : "CONNECT & GET PRICE"}</button>
      </>}

      {(step === "review" || step === "paying") && q && <>
        <div className="sm-quote">
          <div><small>You pay</small><b>{Number(q.amountInFormatted).toFixed(4)} NEAR</b><small>≈ ${Number(q.amountInUsd).toFixed(2)}</small></div>
          <div><small>Your card wallet gets</small><b>${Number(q.amountOutUsd).toFixed(2)}</b><small>about {q.timeEstimate} s</small></div>
        </div>
        <p className="pack-note">Mainnet: this spends real NEAR. The card can sell before you buy it; the funds stay in your card wallet either way. Keep a small balance there for the network fee.</p>
        <button className="cm-btn cm-play qm-btn" disabled={step === "paying"} onClick={pay}>{step === "paying" ? "CONFIRM IN WALLET…" : `PAY ${Number(q.amountInFormatted).toFixed(3)} NEAR`}</button>
      </>}

      {step === "swapping" && <p className="arc-busy" role="status"><RefreshCw size={16} className="sm-spin" />Sending funds to your card wallet… {st ? `(${st.replace(/_/g, " ").toLowerCase()})` : ""}</p>}

      {step === "arrived" && <>
        <p className="pack-note">Done: <b>${Number(q?.amountOutUsd ?? 0).toFixed(2)}</b> is in your card wallet. Buy the card now before someone else does.</p>
        <a className="cm-btn cm-play qm-btn sm-go" href={l.url} target="_blank" rel="noreferrer">BUY ON {SOURCES[l.source].toUpperCase()}<ExternalLink size={18} /></a>
      </>}

      {step === "refunded" && <p className="pack-note bad">The swap could not complete, so NEAR Intents refunded your NEAR to {near.accountId}.</p>}

      {err && <p className="pack-note bad" role="alert">{err}</p>}
      <div className="sm-actions">
        <a className="arc-rules-btn" href={l.url} target="_blank" rel="noreferrer"><ExternalLink size={14} />View listing</a>
        <button className="arc-rules-btn" disabled={busy && step !== "swapping"} onClick={onClose}>{step === "arrived" ? "Done" : "Close"}</button>
      </div>
    </section>
  </div>;
}
