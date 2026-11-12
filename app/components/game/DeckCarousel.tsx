"use client";
import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cardById, decks } from "@/lib/game/catalog";
import HoloCard from "./HoloCard";

const NOTES = ["Safe. Small, steady rewards.", "A bit of both.", "Risky. Bigger rewards, bigger swings."];

/** Swipeable deck picker: one slide per deck style, showing that deck's own card art. */
export function DeckCarousel({ tier, onTier, yearly }: { tier: number; onTier: (t: number) => void; yearly: (t: number) => string }) {
  const n = decks.length;
  const go = (d: number) => onTier((tier + d + n) % n);
  const start = useRef<number | null>(null);
  const deck = decks[tier];
  return (
    <div className="gs-car" style={{ "--tier": deck.color } as React.CSSProperties}
      onPointerDown={(e) => { start.current = e.clientX; }}
      onPointerUp={(e) => { if (start.current !== null && Math.abs(e.clientX - start.current) > 40) go(e.clientX < start.current ? 1 : -1); start.current = null; }}
      onPointerCancel={() => { start.current = null; }}
      onKeyDown={(e) => { if (e.key === "ArrowLeft") go(-1); if (e.key === "ArrowRight") go(1); }}
      tabIndex={0} role="group" aria-roledescription="carousel" aria-label="Choose your deck style">
      <button className="gs-car-arrow" onClick={() => go(-1)} aria-label="Previous deck"><ChevronLeft size={24} strokeWidth={3} /></button>
      <div className="gs-car-slide" key={deck.name}>
        <div className="gs-car-fan">
          {[deck.cards[1], deck.cards[0], deck.cards[2]].map((id, i) => (
            <div key={id} className="gs-car-card" style={{ "--i": i - 1 } as React.CSSProperties}>
              <HoloCard rarity={cardById(id).rarity}><img src={cardById(id).src} alt={cardById(id).name} draggable={false} /></HoloCard>
            </div>
          ))}
        </div>
        <b className="gs-car-name">{deck.name.toUpperCase()}</b>
        <span className="gs-car-sub">{deck.subtitle}</span>
        <span className="gs-car-rate">about {yearly(tier)} a year</span>
        <small>{NOTES[tier]}</small>
      </div>
      <button className="gs-car-arrow" onClick={() => go(1)} aria-label="Next deck"><ChevronRight size={24} strokeWidth={3} /></button>
      <div className="gs-car-dots" role="tablist">
        {decks.map((d, i) => <button key={d.name} role="tab" aria-selected={i === tier} aria-label={d.name} className={i === tier ? "on" : ""} onClick={() => onTier(i)} />)}
      </div>
    </div>
  );
}

/** A deck's card fan with its name, on a glow in the deck's colour. Used on the deck and cash-out screens. */
export function DeckHero({ tier, title, compact = false }: { tier: number; title?: string; compact?: boolean }) {
  const deck = decks[tier];
  return (
    <div className={`gs-hero ${compact ? "compact" : ""}`} style={{ "--tier": deck.color } as React.CSSProperties}>
      <div className="gs-car-fan">
        {[deck.cards[1], deck.cards[0], deck.cards[2]].map((id, i) => (
          <div key={id} className="gs-car-card" style={{ "--i": i - 1 } as React.CSSProperties}>
            <HoloCard rarity={cardById(id).rarity}><img src={cardById(id).src} alt={cardById(id).name} draggable={false} /></HoloCard>
          </div>
        ))}
      </div>
      <b className="gs-car-name">{title ?? deck.name.toUpperCase()}</b>
    </div>
  );
}
