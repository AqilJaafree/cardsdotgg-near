"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import CreatureCard from "@/components/game/CreatureCard";
import { GameScreen } from "@/components/game/GameScreen";
import { TxButton } from "@/components/TxButton";
import { A, cards, TIERS } from "@/lib/contracts";
import { cardById, catalog, decks as deckArt } from "@/lib/game/catalog";
import { defaultArt, fresh, starterCards, type DeckCardsJson } from "@/lib/game/duel";
import { TGAS } from "@/lib/near";
import { useDecks } from "@/lib/useDecks";
import { useView } from "@/lib/useView";

const CRIT = ["5% crit, ×1.3", "12% crit, ×1.5", "25% crit, ×1.8"];
const ROLE = ["LEADER", "BENCH", "BENCH", "BENCH", "HAND", "HAND", "HAND", "HAND"];

// Plain divs with role=button: the global game-button styles would otherwise warp the tile grids.
const tap = (fn: () => void) => ({ role: "button", tabIndex: 0, onClick: fn, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } } });

function Builder() {
  const { decks } = useDecks();
  const live = decks.filter((d) => !d.retired);
  const wanted = useSearchParams().get("deck");
  const deck = live.find((d) => String(d.id) === wanted) ?? live[0];
  const saved = useView<DeckCardsJson>(A.game, "get_deck_cards", deck ? { deck_id: String(deck.id) } : undefined, { enabled: !!deck });

  const [ids, setIds] = useState<number[]>([]);
  const [art, setArt] = useState<number[]>([]);
  const [open, setOpen] = useState<number | null>(null);          // slot being edited in the sheet
  const [group, setGroup] = useState<number | null>(null);        // deck category shown in the creature list (defaults to the deck's own)
  const [pics, setPics] = useState(0);
  // Load what the contract has whenever the deck (or its saved cards) changes.
  useEffect(() => { if (saved.data) { setIds(saved.data.cards); setArt(saved.data.art); setOpen(null); } }, [saved.data?.cards.join(","), saved.data?.art.join(","), deck?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!saved.data && (ids.join() !== saved.data.cards.join() || art.join() !== saved.data.art.join());
  const locked = !!deck && deck.locked > 0n;
  const tier = deck?.tier ?? 0;

  // The picture tabs narrow 102 images down: this deck's own cards first, then all three decks, then the rest.
  const PICS = useMemo(() => {
    const own = new Set<number>(deckArt[tier].cards);
    const all = new Set<number>(deckArt.flatMap((d) => [...d.cards]));
    return [
      { name: "My deck", list: catalog.filter((c) => own.has(c.id)) },
      { name: "All decks", list: catalog.filter((c) => all.has(c.id)) },
      { name: "Pokémon", list: catalog.filter((c) => c.category === "Pokemon") },
      { name: "Extras", list: catalog.filter((c) => c.category !== "Pokemon") },
    ];
  }, [tier]);

  const shell = (body: React.ReactNode) => <GameScreen title="BUILD DECK">{body}</GameScreen>;
  if (!deck) {
    return shell(<section className="qm-card gs-card"><h2>No deck yet</h2><p>You need a deck to change its cards.</p><Link className="cm-btn cm-play qm-btn" href="/deposit">GET COINS</Link></section>);
  }
  // The view fails with MethodNotFound while the testnet contract is still the version without custom decks.
  if (saved.error) {
    const old = /MethodNotFound|MethodResolveError/i.test(saved.error.message);
    return shell(
      <section className="qm-card gs-card">
        <h2>{old ? "Deck builder isn’t live yet" : "Couldn’t load your deck"}</h2>
        <p>{old ? "The game contract on testnet hasn’t been updated with custom decks yet. Your deck still works as before." : saved.error.message.slice(0, 200)}</p>
        <button className="cm-btn cm-collection qm-btn" onClick={() => saved.refetch()}>TRY AGAIN</button>
        <Link className="cm-btn cm-play qm-btn" href="/decks">◀ MY DECKS</Link>
      </section>,
    );
  }
  if (ids.length !== 8) return shell(<section className="qm-card gs-card"><p>Loading your deck…</p></section>);

  const edit = (i: number) => { setOpen(i); setGroup(null); setPics(0); };
  const close = () => setOpen(null);
  /** Put a creature that is not in the deck into the open slot (its picture goes back to the original). */
  function replace(id: number) {
    if (open === null) return;
    setIds(ids.map((x, i) => (i === open ? id : x)));
    setArt(art.map((x, i) => (i === open ? 0 : x)));
    close();
  }
  const skin = (n: number) => { if (open !== null) { setArt(art.map((a, i) => (i === open ? n : a))); close(); } };
  /** Swap the open slot with the leader slot, keeping each card's picture with it. */
  function makeLeader() {
    if (open === null || open === 0) return;
    const swap = <T,>(a: T[]) => a.map((x, i) => (i === 0 ? a[open] : i === open ? a[0] : x));
    setIds(swap(ids)); setArt(swap(art)); close();
  }
  const reset = () => { if (saved.data) { setIds(saved.data.cards); setArt(saved.data.art); } };
  const starter = () => { setIds(starterCards(tier)); setArt(Array(8).fill(0)); };

  const at = (i: number, size: "md" | "sm") => <CreatureCard key={i} size={size} bare card={fresh(ids[i])} art={art[i]} onClick={() => edit(i)} label={`${ROLE[i]}, tap to change`} />;
  const sel = open !== null ? cards[ids[open]] : null;
  const original = open !== null ? cardById(defaultArt(ids[open])) : null;
  // Start on the deck's own category, unless every creature in it is already in the deck: then the first one with choices.
  const firstWithChoices = [tier, ...[0, 1, 2].filter((t) => t !== tier)].find((t) => cards.some((c) => c.tier === t && !ids.includes(c.id))) ?? 3;
  const shown = group ?? firstWithChoices;
  const candidates = cards.filter((c) => !ids.includes(c.id) && (shown === 3 || c.tier === shown));

  return (
    <GameScreen title="BUILD DECK">
      <section className="qm-card gs-card db-board">
        <div className="db-switch" role="tablist" aria-label="Your decks">
          {live.map((d) => {
            const on = d.id === deck.id;
            return (
              <Link key={String(d.id)} role="tab" aria-selected={on} replace scroll={false} href={`/decks/build?deck=${d.id}`}
                className={`db-deck ${on ? "on" : ""}`} style={{ "--tier": deckArt[d.tier].color } as React.CSSProperties}
                onClick={(e) => { if (!on && dirty && !window.confirm("Switch decks? Your unsaved changes to this deck will be lost.")) e.preventDefault(); }}>
                <img src={cardById(deckArt[d.tier].cards[0]).src} alt="" draggable={false} />
                <span><b>{TIERS[d.tier]}</b><small>Deck #{String(d.id)}</small></span>
              </Link>
            );
          })}
        </div>
        <div className="db-top"><b>{TIERS[tier]} deck</b><span>{CRIT[tier]}</span></div>
        {locked && <p className="gs-warn">Your deck is in a bet right now, so it can’t be changed until the match ends.</p>}

        <div className="db-row"><small>LEADER · fights first</small><div className="db-lead">{at(0, "md")}</div></div>
        <div className="db-row"><small>BENCH · steps in next</small><div className="db-trio">{[1, 2, 3].map((i) => at(i, "md"))}</div></div>
        <div className="db-row"><small>HAND · waits its turn</small><div className="db-quad">{[4, 5, 6, 7].map((i) => at(i, "sm"))}</div></div>
        <p className="gs-note db-hint">Tap any card to change it.</p>

        <div className="db-savebar">
          {dirty
            ? <>
                <TxButton label="SAVE MY DECK" disabled={locked} onConfirmed={() => saved.refetch()}
                  request={{ receiverId: A.game, methodName: "set_deck_cards", args: { deck_id: String(deck.id), cards: ids, art }, gas: TGAS(30) }} />
                <button className="cm-btn cm-collection qm-btn" onClick={reset}>UNDO</button>
              </>
            : <>
                <Link className="cm-btn cm-play qm-btn" href={`/play?tier=${tier}`}>BATTLE</Link>
                <button className="cm-btn cm-collection qm-btn" onClick={starter}>RESET</button>
              </>}
        </div>
      </section>

      {open !== null && sel && original && (
        <div className="db-backdrop" onClick={close}>
          <section className="db-sheet" role="dialog" aria-modal="true" aria-label={`Change ${ROLE[open].toLowerCase()} card`} onClick={(e) => e.stopPropagation()}>
            <header className="db-sheet-head">
              <div className="db-sheet-card"><CreatureCard size="sm" bare card={fresh(ids[open])} art={art[open]} label={sel.name} /></div>
              <div>
                <small>{ROLE[open]}{open > 0 ? ` ${open <= 3 ? open : open - 3}` : ""} · {sel.assetClass} · {TIERS[sel.tier]}</small>
                <b>{sel.name}</b>
                <small>HP {sel.hp} · ATK {sel.atk} · DEF {sel.def} · SPD {sel.spd}</small>
                <small><b>{sel.ability}.</b> {sel.rule}</small>
              </div>
              <button className="db-x" onClick={close} aria-label="Close">✕</button>
            </header>
            {open > 0 && <button className="cm-btn cm-play qm-btn" onClick={makeLeader}>MAKE LEADER</button>}

            <h3 className="db-h">Swap for another card</h3>
            <div className="gs-seg four" role="tablist" aria-label="Deck category">
              {[0, 1, 2].map((t) => <button key={t} role="tab" aria-selected={shown === t} className={shown === t ? "on" : ""} onClick={() => setGroup(t)}>{TIERS[t]}{t === tier ? " ★" : ""}</button>)}
              <button role="tab" aria-selected={shown === 3} className={shown === 3 ? "on" : ""} onClick={() => setGroup(3)}>All</button>
            </div>
            {candidates.length === 0
              ? <p className="gs-note">Every card in this group is already in your deck. Try another group.</p>
              : <div className="db-pool">{candidates.map((c) => <CreatureCard key={c.id} size="sm" bare card={fresh(c.id)} onClick={() => replace(c.id)} label={`Swap in ${c.name}`} />)}</div>}
            {shown !== tier && <p className="gs-note">Your deck type stays {TIERS[tier]} ★, so your crit stays {CRIT[tier]}.</p>}

            <details className="db-look">
              <summary>Change how it looks</summary>
              <p className="gs-note">Only the picture changes. {sel.name} keeps the same stats and ability.</p>
              <div className="gs-seg four" role="tablist" aria-label="Picture group">
                {PICS.map((p, i) => <button key={p.name} role="tab" aria-selected={pics === i} className={pics === i ? "on" : ""} onClick={() => setPics(i)}>{p.name}</button>)}
              </div>
              <div className="db-gallery">
                <div {...tap(() => skin(0))} className={`db-tile ${art[open] === 0 ? "on" : ""}`} aria-label="Original picture" title="Original">
                  <img src={original.src} alt={original.name} loading="lazy" draggable={false} /><span className="db-tag">ORIGINAL</span>
                </div>
                {PICS[pics].list.filter((c) => c.id !== original.id).map((c) => (
                  <div key={c.id} {...tap(() => skin(c.id))} className={`db-tile ${art[open] === c.id ? "on" : ""}`} aria-label={c.name} title={c.name}>
                    <img src={c.src} alt={c.name} loading="lazy" draggable={false} />
                  </div>
                ))}
              </div>
            </details>
          </section>
        </div>
      )}
    </GameScreen>
  );
}

export default function BuildDeck() {
  return <Suspense><Builder /></Suspense>;
}
