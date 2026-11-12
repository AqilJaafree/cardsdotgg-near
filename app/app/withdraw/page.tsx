"use client";
import { useState } from "react";
import Link from "next/link";
import { TxButton } from "@/components/TxButton";
import { GameScreen } from "@/components/game/GameScreen";
import { A, ASSETS, fmtAmount, fmtUsd, TIERS, tokenOf } from "@/lib/contracts";
import { useWallet, type CallArgs } from "@/lib/wallet";
import { DeckView, useDecks } from "@/lib/useDecks";
import { useView } from "@/lib/useView";
import { TGAS } from "@/lib/near";

const SLIPPAGE_PCT = 1; // the price can move a little between asking and paying

function Row({ d, refetch }: { d: DeckView; refetch: () => void }) {
  const { accountId } = useWallet();
  const [exit, setExit] = useState(d.asset);
  const q = useView<{ principal_out: string; escrow_out: string }>(A.game, "quote_withdraw", { deck_id: String(d.id), exit_asset: exit }, { interval: 10000 }).data;
  const pOut = BigInt(q?.principal_out ?? 0), eOut = BigInt(q?.escrow_out ?? 0);
  const total = pOut + eOut;
  const minOut = (total * BigInt((100 - SLIPPAGE_PCT) * 100)) / 10000n;
  const blocked = d.locked > 0n;
  // Receiving a coin the first time needs a one-time sign-up on that coin. It rides along in the same approval.
  const registered = useView<unknown>(tokenOf(exit), "storage_balance_of", accountId ? { account_id: accountId } : undefined, { enabled: !!accountId });
  const needsRegister = registered.data === null;
  const withdraw: CallArgs = { receiverId: A.game, methodName: "withdraw", args: { deck_id: String(d.id), exit_asset: exit, min_out: minOut.toString() }, gas: TGAS(60) };
  const register: CallArgs = { receiverId: tokenOf(exit), methodName: "storage_deposit", args: { account_id: accountId, registration_only: true }, deposit: "12500000000000000000000", gas: TGAS(30) };
  return (
    <section className="qm-card gs-card">
      <h2>{TIERS[d.tier]} deck #{String(d.id)}</h2>
      <p>Cashing out closes this deck and sends everything to your wallet.</p>
      <div className="gs-choices two">
        {ASSETS.map((a, i) => <button key={a} className={`gs-choice ${exit === i ? "on" : ""}`} onClick={() => setExit(i)}>Get {a}</button>)}
      </div>
      <div className="gs-stat"><span>You get about</span><b>{fmtAmount(exit, total)} {ASSETS[exit]}</b></div>
      {blocked && <p className="gs-warn">This deck has {fmtUsd(d.locked)} tUSD in a bet. Finish or cancel the match first, then come back.</p>}
      {needsRegister && <p className="gs-note">First time getting {ASSETS[exit]}: a small refundable fee (0.0125 NEAR) is added to the same approval.</p>}
      <TxButton label="CASH OUT" disabled={blocked || !q || (registered.data === undefined && !registered.error)} onConfirmed={refetch}
        request={needsRegister ? [register, withdraw] : withdraw} />
    </section>
  );
}

export default function CashOut() {
  const { decks, refetch } = useDecks();
  const live = decks.filter((d) => !d.retired);
  return (
    <GameScreen title="CASH OUT">
      {live.length === 0 && (
        <section className="qm-card gs-card">
          <h2>Nothing to cash out</h2>
          <p>You don't have a deck right now. Make one first.</p>
          <Link className="cm-btn cm-play qm-btn" href="/deposit">GET COINS</Link>
        </section>
      )}
      {live.map((d) => <Row key={String(d.id)} d={d} refetch={refetch} />)}
    </GameScreen>
  );
}
