"use client";
import Link from "next/link";
import { TxButton } from "@/components/TxButton";
import { GameScreen } from "@/components/game/GameScreen";
import { A, ASSETS, cards, fmtAmount, fmtUsd, TIERS } from "@/lib/contracts";
import { useDecks } from "@/lib/useDecks";
import { TGAS } from "@/lib/near";

const LOOK = ["Safe", "Balanced", "Risky"];

export default function MyDecks() {
  const { decks, refetch } = useDecks();
  const live = decks.filter((d) => !d.retired);
  return (
    <GameScreen title="MY DECKS">
      {live.length === 0 && (
        <section className="qm-card gs-card">
          <h2>No deck yet</h2>
          <p>A deck is what you battle with. Get free coins, put them in, and your deck appears here.</p>
          <Link className="cm-btn cm-play qm-btn" href="/deposit">GET COINS</Link>
        </section>
      )}
      {live.map((d) => {
        const lineup = cards.filter((c) => c.tier === d.tier);
        return (
          <section className="qm-card gs-card" key={String(d.id)}>
            <h2>{TIERS[d.tier]} deck #{String(d.id)}</h2>
            {d.uri && <img className="gs-deckart" src={d.uri} alt={`Deck ${d.id}`} />}
            <div className="gs-stat"><span>Style</span><b>{LOOK[d.tier]}</b></div>
            <div className="gs-stat"><span>Coins in your deck</span><b>{fmtAmount(d.asset, d.principal)} {ASSETS[d.asset]}</b></div>
            <div className="gs-stat"><span>Battle wallet (used for bets)</span><b>{fmtUsd(d.available)} tUSD</b></div>
            {d.locked > 0n && <div className="gs-stat"><span>In a bet right now</span><b>{fmtUsd(d.locked)} tUSD</b></div>}
            <Link className="cm-btn cm-play qm-btn" href={`/play?tier=${d.tier}`}>BATTLE</Link>
            <TxButton label="COLLECT REWARDS" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "checkpoint", args: { deck_id: String(d.id) }, gas: TGAS(30) }} />
            <details className="gs-more"><summary>Cards in this deck</summary>
              {lineup.map((c) => <p key={c.id}><b>{c.name}</b> · HP {c.hp} · Attack {c.atk} · Defense {c.def} · Speed {c.spd}<br />{c.ability}: {c.rule}</p>)}
            </details>
          </section>
        );
      })}
    </GameScreen>
  );
}
