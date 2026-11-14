"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TxButton } from "@/components/TxButton";
import { A, TIERS, type MatchJson } from "@/lib/contracts";
import { useDecks } from "@/lib/useDecks";
import OnlineBattle from "@/components/game/OnlineBattle";
import { SettingsSheet } from "@/components/game/SettingsSheet";
import { useBlockHeight, useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";
import { TGAS } from "@/lib/near";

/** How many recent matches to scan for open challenges and the player's own match. */
const SCAN = 40;
const TTL = 3600;
const short = (a?: string | null) => (a ? (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a) : "");

/**
 * Online quick match, fully onchain: join a random open challenge from another player,
 * or open one and wait until the next player who taps Battle joins it. Then the two of you play the duel turn by turn.
 */
function QuickMatch() {
  const { accountId: me, session } = useWallet();
  const tier = Number(useSearchParams().get("tier") ?? 0);
  const [battleId, setBattleId] = useState<string | null>(null);
  const { decks } = useDecks(!battleId);
  const live = decks.filter((d) => !d.retired);
  const deck = live.find((d) => d.tier === tier) ?? live[0];
  const [needBlock, setNeedBlock] = useState(false); // only the old automatic battle waits for a seed block
  const block = useBlockHeight(4000, needBlock);

  // While a battle is on screen the lobby lists are not needed, so they stop polling (the free RPC rate-limits).
  const reads = useView<MatchJson[]>(A.game, "recent_matches", { limit: SCAN }, { interval: battleId ? undefined : 5000 });
  const rows = reads.data ?? [];
  const refetch = () => reads.refetch();

  const now = Math.floor(Date.now() / 1000);
  // The player's own match that is still in play (waiting, seeding or ready to resolve).
  const mine = rows.find((m) => [0, 1, 2].includes(m.status) && (m.player_a === me || m.player_b === me));
  // Open challenges from other players that this player may join.
  const open = rows.filter((m) => m.status === 0 && m.player_a !== me && (!m.opponent || m.opponent === me) && Number(m.created_at) + TTL > now);
  // Pick one open challenge at random, and keep that pick while the list refreshes.
  const [pick, setPick] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { if (!mine && open.length && (pick === null || !open.some((o) => o.id === pick))) setPick(open[Math.floor(Math.random() * open.length)].id); }, [open.map((o) => o.id).join(","), !!mine]); // eslint-disable-line
  const target = open.find((o) => o.id === pick);

  // Remember the last match this player finished, to show its result.
  useEffect(() => { setNeedBlock(mine?.status === 1); }, [mine?.status]);
  const [doneId, setDoneId] = useState<string | null>(null);
  useEffect(() => { if (mine) setDoneId(mine.id); }, [mine?.id]); // eslint-disable-line
  const done = doneId !== null ? rows.find((m) => m.id === doneId && m.status === 3) : undefined;
  // The battle screen stays up after the match ends (status 3), so the result does not vanish. The player leaves it
  // with Play again, which clears this.
  useEffect(() => { if (mine?.status === 2) setBattleId(mine.id); }, [mine?.id, mine?.status]); // eslint-disable-line
  const battle = mine?.status === 2 ? mine : battleId !== null ? rows.find((m) => m.id === battleId && (m.status === 2 || m.status === 3)) : undefined;
  const rating = useView<number>(A.game, "rating_of", me ? { account_id: me } : undefined, { enabled: !!me, interval: battleId ? undefined : 30000 });

  let body: React.ReactNode;
  if (!deck) {
    body = <>
      <h2>You need a deck first</h2>
      <p>Get free coins, put at least 10 in, and your deck appears. Then you can battle.</p>
      <Link className="cm-btn cm-play qm-btn" href="/deposit">GET A DECK</Link>
    </>;
  } else if (done && !mine) {
    const won = done.winner === me;
    const draw = !done.winner;
    body = <>
      <h2 className={`qm-result ${won ? "win" : draw ? "draw" : "lose"}`}>{draw ? "DRAW" : won ? "VICTORY!" : "DEFEAT"}</h2>
      <p>Match #{done.id} is over. Your rating is now <b>{String(rating.data ?? "…")}</b>.</p>
      <div className="qm-row">
        <Link className="cm-btn cm-collection qm-btn" href={`/match/${done.id}`}>REPLAY</Link>
        <button className="cm-btn cm-play qm-btn" onClick={() => { setDoneId(null); setPick(null); refetch(); }}>PLAY AGAIN</button>
      </div>
    </>;
  } else if (mine) {
    const vs = mine.player_a === me ? mine.player_b : mine.player_a;
    if (mine.status === 0) {
      const left = Math.max(0, Number(mine.created_at) + TTL - now);
      body = <>
        <div className="qm-spinner" aria-hidden />
        <h2>Waiting for a player…</h2>
        <p className="qm-deck">{TIERS[deck.tier]} deck #{String(deck.id)} is in the lobby</p>
        <p>Stay on this screen. The fight starts as soon as another player joins.</p>
        <small>{left > 0 ? `No one yet? The lobby closes in ${Math.ceil(left / 60)} min.` : "The lobby has timed out."}</small>
        <TxButton label="LEAVE LOBBY" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "cancel", args: { match_id: mine.id }, gas: TGAS(40) }} />
        {left === 0 && <TxButton label="CLOSE CHALLENGE" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "expire", args: { match_id: mine.id }, gas: TGAS(40) }} />}
      </>;
    } else {
      const ready = !!block && block > BigInt(mine.seed_block);
      body = <>
        <h2>Opponent found!</h2>
        <p className="qm-vs"><b>You</b> vs <b>{short(vs)}</b></p>
        <p>{ready ? "Everything is set. Tap to start the fight." : "Getting the fight ready…"}</p>
        <TxButton label={ready ? "FIGHT!" : "GETTING READY…"} disabled={!ready} onConfirmed={refetch} request={{ receiverId: A.game, methodName: "resolve", args: { match_id: mine.id }, gas: TGAS(120) }} />
      </>;
    }
  } else if (target) {
    body = <>
      <h2>Opponent found!</h2>
      <p className="qm-vs"><b>You</b> vs <b>{short(target.player_a)}</b></p>
      <p className="qm-deck">Your {TIERS[deck.tier]} deck #{String(deck.id)} is ready</p>
      <p>A player is waiting in the lobby. Tap to join and the fight starts.</p>
      <small>You take turns. One approval now, then no pop-ups during the fight.</small>
      <TxButton label="JOIN BATTLE" withSession onConfirmed={refetch} request={{ receiverId: A.game, methodName: "accept_duel", args: { match_id: target.id, deck_id: String(deck.id) }, gas: TGAS(60) }} />
    </>;
  } else {
    body = <>
      <h2>Ready to battle?</h2>
      <p className="qm-deck">Your {TIERS[deck.tier]} deck #{String(deck.id)}</p>
      <p>Find a player to duel. Knock out 3 cards to win.</p>
      <small>One approval now, then no pop-ups during the fight.</small>
      <TxButton label="FIND OPPONENT" withSession onConfirmed={refetch} request={{ receiverId: A.game, methodName: "create_challenge", args: { deck_id: String(deck.id), opponent: null }, gas: TGAS(60) }} />
    </>;
  }

  // A live duel takes the whole screen, on the same board as practice mode.
  if (battle && me) return <OnlineBattle match={battle} me={me} onLeave={() => { setBattleId(null); setDoneId(null); setPick(null); refetch(); }} />;

  return (
    <div className="qm-screen">
      <header className="qm-top">
        <Link className="cm-btn qm-back" href="/">◀ MENU</Link>
        <span className="qm-top-actions">
          <span className="qm-rating" title="Your rating"><small>RATING</small><b>{String(rating.data ?? "…")}</b></span>
          <button className="cm-square qm-gear" onClick={() => setSettingsOpen(true)} aria-label={session.active ? "Settings (quick play is on)" : "Settings"}>⚙{session.active && <i className="qm-dot" title="Quick play is on" />}</button>
          <Link className="cm-square qm-trophy" href="/leaderboard" aria-label="Leaderboard">🏆</Link>
        </span>
      </header>
      <section className="qm-card">{body}</section>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      <p className="qm-foot">Online · NEAR testnet</p>
    </div>
  );
}

export default function PlayPage() {
  return <Suspense><QuickMatch /></Suspense>;
}
