"use client";
import Link from "next/link";
import { Lock, Package, Shield, Sparkles, Ticket } from "lucide-react";
import { GameScreen, ARCADE_TABS } from "./GameScreen";
import { SEASON } from "@/lib/game/catalog";
import { useTickets } from "@/lib/game/arcade";
import { useRwaStock } from "@/lib/game/rwa";

type Item = {
  key: string; name: string; blurb: string; cost: string; art: React.ReactNode;
  /** Live items redeem tickets; upcoming ones are only listed. */
  live?: { have: number; href: string; earn: string; earnHref: string };
};

/** The ticket counter: arcade tickets are spent here on packs, and upcoming items are listed before they arrive. */
export default function Market() {
  const { t, season } = useTickets();
  const stock = useRwaStock().data;
  const items: Item[] = [
    {
      key: "trial", name: "Trial pack", cost: "1 Pack Ticket", blurb: "5 trial pictures and 1 creature for your decks.",
      art: <img src="/cards/pack-guardian.svg" alt="" />,
      live: { have: t?.pack ?? 0, href: "/packs", earn: "Play Stacker", earnHref: "/arcade" },
    },
    {
      key: "season", name: `${SEASON.name} pack`, cost: "1 Season Ticket",
      blurb: `1 real card, yours as an NFT.${stock ? ` ${stock.remaining} of ${stock.total} left.` : ""}`,
      art: <img src={SEASON.pack} alt="" />,
      live: { have: season, href: "/packs?tab=season", earn: "Play the Claw", earnHref: "/arcade" },
    },
    { key: "s2", name: "Season 2 pack", cost: "Season Ticket", blurb: "The next set of real cards, tokenized one of one.", art: <Sparkles size={46} /> },
    { key: "sleeves", name: "Card sleeves", cost: "Pack Tickets", blurb: "Cosmetic sleeves for your battle decks.", art: <Shield size={46} /> },
    { key: "box", name: "Booster box", cost: "Season Tickets", blurb: "A sealed box of physical packs, shipped to you.", art: <Package size={46} /> },
  ];
  return <GameScreen title="MARKET" tabs={ARCADE_TABS}>
    <div className="arc-wallet" aria-label="Your tickets">
      <span><Ticket size={16} /><b>{t?.pack ?? 0}</b> Pack</span>
      <span className="season"><Sparkles size={16} /><b>{season}</b> Season</span>
    </div>
    <div className="mk-grid">{items.map((it) => {
      const ready = !!it.live && it.live.have > 0;
      return <section key={it.key} className={`qm-card gs-card mk-item ${it.live ? "" : "soon"}`}>
        {!it.live && <span className="arc-tag soon"><Lock size={11} />COMING SOON</span>}
        <div className="mk-art">{it.art}</div>
        <h2>{it.name}</h2>
        <p>{it.blurb}</p>
        <span className="mk-cost"><Ticket size={14} />{it.cost}</span>
        {it.live ? (ready
          ? <Link className="cm-btn cm-play qm-btn mk-btn" href={it.live.href}>REDEEM ({it.live.have})</Link>
          : <Link className="cm-btn cm-collection qm-btn mk-btn" href={it.live.earnHref}>{it.live.earn}</Link>)
          : <button className="cm-btn cm-collection qm-btn mk-btn" disabled>SOON</button>}
      </section>;
    })}</div>
  </GameScreen>;
}
