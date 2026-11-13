"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TxButton } from "@/components/TxButton";
import { A, TIERS, type MatchJson } from "@/lib/contracts";
import { useDecks } from "@/lib/useDecks";
import OnlineBattle from "@/components/game/OnlineBattle";
import { QuickPlay } from "@/components/game/QuickPlay";
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
  const { accountId: me } = useWallet();
  const tier = Number(useSearchParams().get("tier") ?? 0);
  const { decks } = useDecks();
  const live = decks.filter((d) => !d.retired);
  const deck = live.find((d) => d.tier === tier) ?? live[0];
  const block = useBlockHeight();

  const reads = useView<MatchJson[]>(A.game, "recent_matches", { limit: SCAN }, { interval: 3000 });
  const rows = reads.data ?? [];
  const refetch = () => reads.refetch();

  const now = Math.floor(Date.now() / 1000);
  // The player's own match that is still in play (waiting, seeding or ready to resolve).
  const mine = rows.find((m) => [0, 1, 2].includes(m.status) && (m.player_a === me || m.player_b === me));
  // Open challenges from other players that this player may join.
  const open = rows.filter((m) => m.status === 0 && m.player_a !== me && (!m.opponent || m.opponent === me) && Number(m.created_at) + TTL > now);
  // Pick one open challenge at random, and keep that pick while the list refreshes.
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { if (!mine && open.length && (pick === null || !open.some((o) => o.id === pick))) setPick(open[Math.floor(Math.random() * open.length)].id); }, [open.map((o) => o.id).join(","), !!mine]); // eslint-disable-line
  const target = open.find((o) => o.id === pick);

  // Remember the last match this player finished, to show its result.
  const [doneId, setDoneId] = useState<string | null>(null);
  useEffect(() => { if (mine) setDoneId(mine.id); }, [mine?.id]); // eslint-disable-line
  const done = doneId !== null ? rows.find((m) => m.id === doneId && m.status === 3) : undefined;
  const rating = useView<number>(A.game, "rating_of", me ? { account_id: me } : undefined, { enabled: !!me, interval: 5000 });

  let body: React.ReactNode;
  if (!deck) {
    body = <>
      <h2>You need a deck first</h2>
      <p>Your deck is a vault position on NEAR. Claim testnet tUSD, deposit at least 10 and you get a deck to battle with.</p>
      <Link className="cm-btn cm-play qm-btn" href="/deposit">GET A DECK</Link>
    </>;
  } else if (done && !mine) {
    const won = done.winner === me;
    const draw = !done.winner;
    body = <>
      <h2 className={`qm-result ${won ? "win" : draw ? "draw" : "lose"}`}>{draw ? "DRAW" : won ? "VICTORY!" : "DEFEAT"}</h2>
      <p>Match #{done.id} settled onchain. Your rating is now <b>{String(rating.data ?? "…")}</b>.</p>
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
        <h2>Searching for an opponent…</h2>
        <p>Your challenge #{mine.id} is open. The next player who taps Battle joins it. Keep this screen open.</p>
        <small>It closes by itself in {Math.ceil(left / 60)} min if nobody joins.</small>
        <TxButton label="CANCEL SEARCH" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "cancel", args: { match_id: mine.id }, gas: TGAS(40) }} />
        {left === 0 && <TxButton label="CLOSE CHALLENGE" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "expire", args: { match_id: mine.id }, gas: TGAS(40) }} />}
      </>;
    } else {
      const ready = !!block && block > BigInt(mine.seed_block);
      body = <>
        <h2>Opponent found!</h2>
        <p className="qm-vs"><b>You</b> vs <b>{short(vs)}</b></p>
        <p>{ready ? "The battle seed is set. The keeper normally resolves the battle within a few seconds; if it does not, press the button." : "Rolling the battle seed on the next block…"}</p>
        <TxButton label={ready ? "FIGHT!" : "WAITING FOR SEED…"} disabled={!ready} onConfirmed={refetch} request={{ receiverId: A.game, methodName: "resolve", args: { match_id: mine.id }, gas: TGAS(120) }} />
      </>;
    }
  } else if (target) {
    body = <>
      <h2>Opponent found!</h2>
      <p className="qm-vs"><b>You</b> vs <b>{short(target.player_a)}</b></p>
      <p>Join their open challenge with your {TIERS[deck.tier]} deck #{String(deck.id)}. You take turns, and every move is recorded onchain. One approval now turns on quick play, so the fight itself has no pop-ups.</p>
      <TxButton label="JOIN BATTLE" withSession onConfirmed={refetch} request={{ receiverId: A.game, methodName: "accept_duel", args: { match_id: target.id, deck_id: String(deck.id) }, gas: TGAS(60) }} />
    </>;
  } else {
    body = <>
      <h2>Ready to battle</h2>
      <p>Nobody is waiting right now. Open a challenge and the next player who taps Battle is matched with you.</p>
      <p><small>{TIERS[deck.tier]} deck #{String(deck.id)} · stake comes from your yield escrow, or the match is Rank-only. One approval also turns on quick play: no pop-ups during the fight.</small></p>
      <TxButton label="FIND OPPONENT" withSession onConfirmed={refetch} request={{ receiverId: A.game, methodName: "create_challenge", args: { deck_id: String(deck.id), opponent: null }, gas: TGAS(60) }} />
    </>;
  }

  // A live duel takes the whole screen, on the same board as practice mode.
  if (mine && mine.status === 2 && me) return <OnlineBattle match={mine} me={me} onDone={refetch} />;

  return (
    <div className="qm-screen">
      <header className="qm-top">
        <Link className="cm-btn qm-back" href="/">◀ MENU</Link>
        <Link className="cm-square" href="/leaderboard" aria-label="Leaderboard">🏆</Link>
      </header>
      <section className="qm-card">{body}</section>
      <QuickPlay offer={false} />
      <p className="qm-foot">Online · NEAR testnet · rating {String(rating.data ?? "…")}</p>
    </div>
  );
}

export default function PlayPage() {
  return <Suspense><QuickMatch /></Suspense>;
}
