"use client";
import { cardById, catalog } from "@/lib/game/catalog";
import { creature, defaultArt, type DuelCard } from "@/lib/game/duel";

const CLASS_COLOR: Record<string, string> = { Stable: "#4ea5d9", Treasury: "#5fa56b", Gold: "#d9a441", Credit: "#9b6bd1", BTC: "#e8803a" };
const CLASS_GLYPH: Record<string, string> = { Stable: "◎", Treasury: "▣", Gold: "◆", Credit: "❖", BTC: "₿" };
const TIER = ["Guardian", "Balanced", "Degen"];

/** A creature card face drawn from its stats and class. There is no per-creature art yet. */
export default function CreatureCard({ card, size = "lg", onClick, edge, label, art = 0, bare = false, selected = false }: { card: DuelCard; size?: "lg" | "md" | "sm"; onClick?: () => void; edge?: "up" | "down"; label?: string; art?: number; bare?: boolean; selected?: boolean }) {
  const c = creature(card.id);
  // Art 0 means the creature's own deck art, so a starter deck looks the same here as on the deck screens.
  const skin = cardById(art > 0 && catalog.some((x) => x.id === art) ? art : defaultArt(card.id));
  const color = CLASS_COLOR[c.assetClass] ?? "#888";
  const pct = Math.max(0, Math.min(1, card.hp / card.max_hp));
  // A div with role=button, not a <button>, so the global game-button styles do not apply to the card face.
  const press = onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } } : {};
  return (
    <div {...press} className={`cc cc-${size} ${edge ? `cc-edge-${edge}` : ""} ${selected ? "cc-selected" : ""}`} style={{ "--cc": color } as React.CSSProperties} aria-label={`${c.name}, ${card.hp} of ${card.max_hp} HP${label ? `. ${label}` : ""}`}>
      <span className="cc-class">{c.assetClass}</span>
      <img className="cc-art" src={skin.src} alt={skin.name} draggable={false} loading="lazy" />
      <span className="cc-glyph" aria-hidden>{CLASS_GLYPH[c.assetClass]}</span>
      <b className="cc-name">{c.name}</b>
      {!bare && <span className="cc-hp"><i style={{ width: `${pct * 100}%`, background: pct < 0.3 ? "#eb795d" : undefined }} /></span>}
      {!bare && <small className="cc-hptext">{card.hp} / {card.max_hp}</small>}
      {size === "lg" && <span className="cc-stats">ATK {c.atk + card.atk_bonus} · DEF {c.def} · SPD {c.spd}</span>}
      {size === "lg" && <span className="cc-tier">{TIER[c.tier]}</span>}
      {!bare && <span className="cc-energy" aria-label={`${card.energy} energy`}>{Array.from({ length: card.energy }, (_, i) => <i key={i} />)}</span>}
      {edge && <span className="cc-edgebadge">{edge === "up" ? "Hits ×1.25 ▲" : "Hits ×0.8 ▼"}</span>}
      {card.shield_cd > 0 && c.ability === "Peg Shield" && <span className="cc-chip">Shield {card.shield_cd}</span>}
      {card.widen > 0 && <span className="cc-chip">DEF −10%</span>}
    </div>
  );
}
