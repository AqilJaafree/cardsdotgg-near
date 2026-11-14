"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Gate } from "@/components/NotDeployed";

const TABS: [string, string][] = [["/deposit", "GET COINS"], ["/decks", "MY DECKS"], ["/withdraw", "CASH OUT"], ["/pool", "SWAP"], ["/arena", "FRIENDS"]];

/** Shared full-screen layout for the wallet pages: same look as Battle and the leaderboard, one row of tabs. */
/** The arcade's own row of tabs. */
export const ARCADE_TABS: [string, string][] = [["/arcade", "ARCADE"], ["/market", "MARKET"]];

export function GameScreen({ title, children, tabs = TABS }: { title: string; children: React.ReactNode; tabs?: [string, string][] }) {
  const path = usePathname();
  return (
    <div className="qm-screen">
      <header className="qm-top">
        <Link className="cm-btn qm-back" href="/">◀ MENU</Link>
        <Link className="cm-square" href="/leaderboard" aria-label="Leaderboard">🏆</Link>
      </header>
      <h1 className="gs-title">{title}</h1>
      <nav className="gs-tabs" aria-label="Sections">
        {tabs.map(([href, name]) => <Link key={href} href={href} className={`gs-tab ${path === href ? "on" : ""}`}>{name}</Link>)}
      </nav>
      <Gate>{children}</Gate>
      <p className="qm-foot">NEAR testnet · test coins are free and have no real value</p>
    </div>
  );
}
