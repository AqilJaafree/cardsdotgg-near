"use client";
import { useState } from "react";
import { TxButton } from "@/components/TxButton";
import { GameScreen } from "@/components/game/GameScreen";
import { A, ASSETS, fmtAmount, fmtUsd, parseAmount, tokenOf, type OracleJson } from "@/lib/contracts";
import { useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";
import { ONE_YOCTO, TGAS } from "@/lib/near";

const STYLES = [
  { name: "Guardian", note: "Safe. Small, steady rewards." },
  { name: "Balanced", note: "A bit of both." },
  { name: "Degen", note: "Risky. Bigger rewards, bigger swings." },
];

export default function GetCoins() {
  const { accountId } = useWallet();
  const [asset, setAsset] = useState(0);
  const [tier, setTier] = useState(0);
  const [amt, setAmt] = useState("10");
  const token = tokenOf(asset);
  const dec = asset === 0 ? 6 : 24;
  const me = accountId ? { account_id: accountId } : undefined;
  const q = { enabled: !!accountId, interval: 8000 };
  const balUsd = useView<string>(A.tusd, "ft_balance_of", me, q);
  const balNear = useView<string>(A.tnear, "ft_balance_of", me, q);
  const nextUsd = useView<string>(A.tusd, "next_claim_at", me, q);
  const nextNear = useView<string>(A.tnear, "next_claim_at", me, q);
  const oracle = useView<OracleJson>(A.game, "oracle", {}, { interval: 30000 });
  const now = Math.floor(Date.now() / 1000);
  const waitH = Math.ceil(Math.max(Number(nextUsd.data ?? 0), Number(nextNear.data ?? 0)) - now) / 3600;
  const price = BigInt(oracle.data?.usd_per_near_1e6 ?? 0);
  const amount = parseAmount(amt, dec);
  const worth = asset === 0 ? amount : (amount * price) / 10n ** 24n;
  const refetch = () => { balUsd.refetch(); balNear.refetch(); nextUsd.refetch(); nextNear.refetch(); };
  const yearly = (i: number) => { const r = oracle.data?.rates_bps[i]; return r === undefined ? "…" : `${(r / 100).toFixed(1)}%`; };
  return (
    <GameScreen title="GET COINS">
      <section className="qm-card gs-card">
        <h2>1. Free coins</h2>
        <p>Grab free test coins to play with. You can claim again every 24 hours.</p>
        <div className="gs-stat"><span>You have</span><b>{fmtUsd(BigInt(balUsd.data ?? 0))} tUSD · {fmtAmount(1, BigInt(balNear.data ?? 0))} tNEAR</b></div>
        <TxButton label={waitH > 0 ? `CLAIM IN ${Math.ceil(waitH)}H` : "CLAIM FREE COINS"} disabled={waitH > 0} onConfirmed={refetch}
          request={[{ receiverId: A.tusd, methodName: "claim", gas: TGAS(30) }, { receiverId: A.tnear, methodName: "claim", gas: TGAS(30) }]} />
        <p className="gs-note">You also need a tiny bit of test NEAR for network fees. Get it free at <a href="https://near-faucet.io/" target="_blank" rel="noreferrer">near-faucet.io</a>.</p>
      </section>

      <section className="qm-card gs-card">
        <h2>2. Make your deck</h2>
        <p>Put coins in to get a deck. The deck keeps earning rewards while you play. You can cash out any time.</p>
        <div className="gs-choices">
          {STYLES.map((s, i) => (
            <button key={s.name} className={`gs-choice ${tier === i ? "on" : ""}`} onClick={() => setTier(i)}>
              {s.name} · about {yearly(i)} a year<small>{s.note}</small>
            </button>
          ))}
        </div>
        <div className="gs-choices two">
          {ASSETS.map((a, i) => <button key={a} className={`gs-choice ${asset === i ? "on" : ""}`} onClick={() => setAsset(i)}>{a}</button>)}
        </div>
        <input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" aria-label="Amount" />
        <p className="gs-note">Minimum: 10 tUSD{asset === 1 && amount > 0n ? ` · your tNEAR is worth about ${fmtUsd(worth)} tUSD` : ""}.</p>
        <TxButton label="MAKE MY DECK" disabled={amount === 0n || worth < 10_000_000n} onConfirmed={refetch}
          request={{ receiverId: token, methodName: "ft_transfer_call", gas: TGAS(100), deposit: ONE_YOCTO,
            args: { receiver_id: A.game, amount: amount.toString(), msg: JSON.stringify({ action: "deposit", tier }) } }} />
        <p className="gs-note">Rewards are test coins paid from the game's pot, at rates based on real Rhea pools.</p>
      </section>
    </GameScreen>
  );
}
