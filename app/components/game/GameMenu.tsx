"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Maximize2, Trophy, Vault, Volume2, VolumeX } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { A } from "@/lib/contracts";
import { cardById, decks } from "@/lib/game/catalog";
import { defaultArt, type DeckCardsJson } from "@/lib/game/duel";
import { useDecks } from "@/lib/useDecks";
import { useView } from "@/lib/useView";
import HoloCard from "./HoloCard";

const FONT = "https://fonts.googleapis.com/css2?family=Lilita+One&display=swap";

/** Chunky two-line game logo: "CARDS" over "DOT GG". */
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className={`cm-logo ${small ? "small" : ""}`} aria-label={BRAND}>
      <span className="cm-logo-top">CARDS</span>
      <span className="cm-logo-bottom">DOT<i>GG</i></span>
    </div>
  );
}

/** Title screen: shown once per browser session, then the menu takes over until the tab is closed. */
export function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <button className="start-screen start-banner-screen" onClick={onStart} aria-label="Tap to start">
      <link rel="stylesheet" href={FONT} />
      <img className="start-banner" src="/cardsdotgg-banner.jpg" alt="Cardsdotgg: collect, build, battle" draggable={false} />
      <span className="start-tap">Tap to start</span>
    </button>
  );
}

/** Main menu in the style of a casual mobile game: logo, a stack of chunky buttons, a row of square icon buttons. */
export function MainMenu({ tier, onTier, onBattle, audio, onAudio }: { tier: number; onTier: (t: number) => void; onBattle: () => void; audio: boolean; onAudio: () => void }) {
  const deck = decks[tier];
  // Your real deck of this type, if you have one. Without it the menu shows the fixed trial deck, which is not yours.
  const { decks: chainDecks } = useDecks();
  const mine = chainDecks.find((d) => !d.retired && d.tier === tier);
  const saved = useView<DeckCardsJson>(A.game, "get_deck_cards", mine ? { deck_id: String(mine.id) } : undefined, { enabled: !!mine });
  const pics = saved.data ? saved.data.cards.slice(0, 3).map((id, i) => saved.data!.art[i] || defaultArt(id)) : deck.cards.slice(0, 3);
  const step = (d: number) => onTier((tier + d + decks.length) % decks.length);
  function fullscreen() {
    try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {}
  }
  return (
    <div className="cm-menu">
      <link rel="stylesheet" href={FONT} />
      <img className="cm-logo-img" src="/cardsdotgg-logo.jpg" alt={`${BRAND}: collect, build, battle`} draggable={false} />

      <div className="cm-deck">
        <div className="cm-fan">
          {[pics[1], pics[0], pics[2]].map((id, i) => (
            <div key={i} className="cm-fan-card" style={{ "--i": i - 1 } as React.CSSProperties}>
              <HoloCard rarity={cardById(id).rarity}><img src={cardById(id).src} alt={cardById(id).name} draggable={false} /></HoloCard>
            </div>
          ))}
        </div>
        <div className="cm-picker" style={{ "--tier": deck.color } as React.CSSProperties}>
          <button onClick={() => step(-1)} aria-label="Previous deck"><ChevronLeft size={22} strokeWidth={3} /></button>
          <span><small>{mine ? `YOUR TRIAL DECK #${mine.id}` : "TRIAL DECK"}</small>{deck.name.toUpperCase()}</span>
          <button onClick={() => step(1)} aria-label="Next deck"><ChevronRight size={22} strokeWidth={3} /></button>
        </div>
      </div>

      <nav className="cm-buttons">
        <Link className="cm-btn cm-play" href={`/play?tier=${tier}`}>BATTLE</Link>
        <button className="cm-btn cm-ranked" onClick={onBattle}>PRACTICE</button>
        <Link className="cm-btn cm-packs" href="/packs">PACKS</Link>
        <Link className="cm-btn cm-collection" href="/collection">COLLECTION</Link>
      </nav>

      <div className="cm-icons">
        <Link className="cm-square" href="/decks" aria-label="Vault"><Vault size={24} strokeWidth={2.5} /></Link>
        <Link className="cm-square" href="/leaderboard" aria-label="Leaderboard"><Trophy size={24} strokeWidth={2.5} /></Link>
        <button className="cm-square" onClick={fullscreen} aria-label="Fullscreen"><Maximize2 size={24} strokeWidth={2.5} /></button>
        <button className="cm-square" onClick={onAudio} aria-label={audio ? "Mute sound" : "Enable sound"}>{audio ? <Volume2 size={24} strokeWidth={2.5} /> : <VolumeX size={24} strokeWidth={2.5} />}</button>
      </div>
    </div>
  );
}
