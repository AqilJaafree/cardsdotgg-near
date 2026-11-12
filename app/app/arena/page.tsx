"use client";
import Link from "next/link";
import { useState } from "react";
import { TxButton } from "@/components/TxButton";
import { GameScreen } from "@/components/game/GameScreen";
import { A, fmtUsd, TIERS, type MatchJson } from "@/lib/contracts";
import { useDecks } from "@/lib/useDecks";
import { useBlockHeight, useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";
import { TGAS } from "@/lib/near";

const ACCOUNT = /^[a-z0-9._-]{2,64}$/;
const short = (a?: string | null) => (a ? (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a) : "anyone");

function Row({ m, myDecks, refetch }: { m: MatchJson; myDecks: bigint[]; refetch: () => void }) {
  const { accountId } = useWallet();
  const block = useBlockHeight();
  const [picked, setDeck] = useState("");
  const deck = picked || (myDecks[0] ? String(myDecks[0]) : "");
  const mine = !!accountId && m.player_a === accountId;
  const bet = BigInt(m.stake_a) > 0n;
  const ready = !!block && block > BigInt(m.seed_block);
  return (
    <div className="gs-choice" style={{ cursor: "default" }}>
      <span>{mine ? "Your challenge" : `${short(m.player_a)} wants to battle`}</span>
      <small>{bet ? `Bet: ${fmtUsd(BigInt(m.stake_a))} tUSD each` : "Just for rank, no bet"}</small>
      {m.status === 0 && !mine && myDecks.length > 0 && (
        <>
          <select value={deck} onChange={(e) => setDeck(e.target.value)}>{myDecks.map((d) => <option key={String(d)} value={String(d)}>Deck #{String(d)}</option>)}</select>
          <TxButton label="ACCEPT" disabled={!deck} onConfirmed={refetch} request={{ receiverId: A.game, methodName: "accept", args: { match_id: m.id, deck_id: deck }, gas: TGAS(60) }} />
        </>
      )}
      {m.status === 0 && mine && <TxButton label="CANCEL" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "cancel", args: { match_id: m.id }, gas: TGAS(40) }} />}
      {m.status === 1 && <small>Battle starting… it plays itself in a few seconds.</small>}
      {m.status === 1 && ready && <TxButton label="FIGHT!" onConfirmed={refetch} request={{ receiverId: A.game, methodName: "resolve", args: { match_id: m.id }, gas: TGAS(120) }} />}
      {m.status === 3 && <Link className="gs-mini" href={`/match/${m.id}`}>WATCH REPLAY</Link>}
    </div>
  );
}

export default function Friends() {
  const { accountId } = useWallet();
  const { decks } = useDecks();
  const live = decks.filter((d) => !d.retired);
  const [deck, setDeck] = useState("");
  const [friend, setFriend] = useState("");
  const matches = useView<MatchJson[]>(A.game, "recent_matches", { limit: 8 }, { interval: 8000 });
  const sel = deck || (live[0] ? String(live[0].id) : "");
  const stake = live.find((d) => String(d.id) === sel);
  const friendOk = friend === "" || ACCOUNT.test(friend);
  const rows = (matches.data ?? []).filter((m) => m.status !== 4);
  return (
    <GameScreen title="FRIENDS">
      <section className="qm-card gs-card">
        <h2>Challenge a friend</h2>
        {live.length === 0 ? (
          <><p>You need a deck first.</p><Link className="cm-btn cm-play qm-btn" href="/deposit">GET COINS</Link></>
        ) : (
          <>
            <select value={sel} onChange={(e) => setDeck(e.target.value)} aria-label="Your deck">
              {live.map((d) => <option key={String(d.id)} value={String(d.id)}>{TIERS[d.tier]} deck #{String(d.id)}</option>)}
            </select>
            <input placeholder="Friend's account (leave empty for anyone)" value={friend} onChange={(e) => setFriend(e.target.value.trim())} aria-label="Friend's account" />
            {!friendOk && <p className="gs-warn">That doesn't look like a NEAR account name.</p>}
            {stake && <p className="gs-note">{stake.available > 0n ? "The match is for a small bet if you both have enough in your battle wallet. Otherwise it is just for rank." : "Your battle wallet is empty, so this match is just for rank."}</p>}
            <TxButton label="SEND CHALLENGE" disabled={!accountId || !sel || !friendOk} onConfirmed={() => matches.refetch()}
              request={{ receiverId: A.game, methodName: "create_challenge", args: { deck_id: sel, opponent: friend || null }, gas: TGAS(60) }} />
            <p className="gs-note">Want a random opponent? Tap BATTLE on the main menu instead.</p>
          </>
        )}
      </section>
      {rows.length > 0 && (
        <section className="qm-card gs-card">
          <h2>Latest matches</h2>
          <div className="gs-choices">{rows.map((m) => <Row key={m.id} m={m} myDecks={live.map((d) => d.id)} refetch={() => matches.refetch()} />)}</div>
        </section>
      )}
    </GameScreen>
  );
}
