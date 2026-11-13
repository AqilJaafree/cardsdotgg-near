"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { TxButton } from "@/components/TxButton";
import { GameScreen } from "@/components/game/GameScreen";
import { DeckHero } from "@/components/game/DeckCarousel";
import { A, ASSETS, cards, fmtAmount, fmtUsd, TIERS } from "@/lib/contracts";
import { type DeckCardsJson } from "@/lib/game/duel";
import { useDecks, type DeckView } from "@/lib/useDecks";
import { useView } from "@/lib/useView";
import { TGAS } from "@/lib/near";

const LOOK = ["Safe", "Balanced", "Risky"];

/** The deck's real cards: its custom picks if it has any, otherwise its tier's starter cards. */
function Lineup({ deck }: { deck: DeckView }) {
  const saved = useView<DeckCardsJson>(A.game, "get_deck_cards", { deck_id: String(deck.id) });
  const list = saved.data ? saved.data.cards.map((id) => cards[id]) : cards.filter((c) => c.tier === deck.tier);
  return (
    <details className="gs-more"><summary>Cards in this deck{saved.data?.custom ? " (custom)" : ""}</summary>
      {deck.uri && <img className="gs-deckart" src={deck.uri} alt={`Deck ${deck.id} card sheet`} />}
      {list.map((c) => <p key={c.id}><b>{c.name}</b> · HP {c.hp} · Attack {c.atk} · Defense {c.def} · Speed {c.spd}<br />{c.ability}: {c.rule}</p>)}
    </details>
  );
}

export default function MyDecks() {
  const { decks, refetch } = useDecks();
  const live = decks.filter((d) => !d.retired);
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const n = live.length;
  const goto = (i: number) => {
    const el = track.current; if (!el) return;
    const k = Math.max(0, Math.min(n - 1, i));
    el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" });
    setAt(k);
  };
  // Swiping is native scroll-snap; this keeps the dots in step with it.
  const onScroll = () => { const el = track.current; if (el && el.clientWidth) setAt(Math.round(el.scrollLeft / el.clientWidth)); };

  return (
    <GameScreen title="MY DECKS">
      {n === 0 && (
        <section className="qm-card gs-card">
          <h2>No deck yet</h2>
          <p>A deck is what you battle with. Get free coins, put them in, and your deck appears here.</p>
          <Link className="cm-btn cm-play qm-btn" href="/deposit">GET COINS</Link>
        </section>
      )}
      {n > 0 && (
        <div className="dk-car" role="group" aria-roledescription="carousel" aria-label="Your decks">
          <div className="dk-track" ref={track} onScroll={onScroll}>
            {live.map((d, i) => (
              <div className="dk-slide" key={String(d.id)} role="group" aria-roledescription="slide" aria-label={`Deck ${i + 1} of ${n}`}>
                <section className="qm-card gs-card">
                  <h2>Deck #{String(d.id)}</h2>
                  <DeckHero tier={d.tier} title={`${TIERS[d.tier].toUpperCase()} · ${LOOK[d.tier]}`} />
                  <div className="gs-chips">
                    <div className="gs-chip"><small>Coins in your deck</small><b>{fmtAmount(d.asset, d.principal)} {ASSETS[d.asset]}</b></div>
                    <div className="gs-chip"><small>Battle wallet (for bets)</small><b>{fmtUsd(d.available)} tUSD</b></div>
                    {d.locked > 0n && <div className="gs-chip wide warn"><small>In a bet right now</small><b>{fmtUsd(d.locked)} tUSD</b></div>}
                  </div>
                  <div className="gs-actions">
                    <Link className="cm-btn cm-play qm-btn" href={`/play?tier=${d.tier}`}>BATTLE</Link>
                    <Link className="cm-btn cm-collection qm-btn" href={`/decks/build?deck=${d.id}`}>CUSTOMIZE CARDS</Link>
                    <TxButton tone="soft" label="COLLECT REWARDS" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "checkpoint", args: { deck_id: String(d.id) }, gas: TGAS(30) }} />
                  </div>
                  <Lineup deck={d} />
                </section>
              </div>
            ))}
          </div>
          {n > 1 && (
            <div className="dk-nav">
              <button className="dk-arrow" onClick={() => goto(at - 1)} disabled={at === 0} aria-label="Previous deck"><ChevronLeft size={22} strokeWidth={3} /></button>
              <div className="dk-dots" role="tablist" aria-label="Choose a deck">
                {live.map((d, i) => <button key={String(d.id)} role="tab" aria-selected={i === at} aria-label={`Deck #${d.id}`} className={i === at ? "on" : ""} onClick={() => goto(i)} />)}
              </div>
              <button className="dk-arrow" onClick={() => goto(at + 1)} disabled={at === n - 1} aria-label="Next deck"><ChevronRight size={22} strokeWidth={3} /></button>
            </div>
          )}
        </div>
      )}
    </GameScreen>
  );
}
