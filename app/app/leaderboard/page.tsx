"use client";
import Link from "next/link";
import { A, type MatchJson } from "@/lib/contracts";
import { useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";

const short = (a: string) => (a.length > 18 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a);

/** Every player who has finished a match onchain, ranked by their onchain Elo rating, with wins and losses from settled matches. */
export default function Leaderboard() {
  const { accountId: me } = useWallet();
  const players = useView<{ account: string; rating: number }[]>(A.game, "players", { from_index: 0, limit: 200 }, { interval: 10000 });
  const matches = useView<MatchJson[]>(A.game, "recent_matches", { limit: 100 }, { interval: 10000 });
  const n = Number(useView<string>(A.game, "match_count", {}, { interval: 10000 }).data ?? 0);

  const stats = new Map<string, { w: number; l: number; d: number }>();
  const get = (p: string) => stats.get(p) ?? (stats.set(p, { w: 0, l: 0, d: 0 }), stats.get(p)!);
  for (const m of matches.data ?? []) {
    if (m.status !== 3 || !m.player_b) continue;
    if (!m.winner) { get(m.player_a).d++; get(m.player_b).d++; }
    else { get(m.winner).w++; get(m.winner === m.player_a ? m.player_b : m.player_a).l++; }
  }
  const rows = (players.data ?? [])
    .map((p) => ({ p: p.account, r: p.rating, ...(stats.get(p.account) ?? { w: 0, l: 0, d: 0 }) }))
    .sort((x, y) => y.r - x.r || y.w - x.w);

  return (
    <div className="qm-screen lb-screen">
      <header className="qm-top">
        <Link className="cm-btn qm-back" href="/">◀ MENU</Link>
        <Link className="cm-btn cm-play qm-back" href="/play">BATTLE</Link>
      </header>
      <h1 className="lb-title">LEADERBOARD</h1>
      <section className="qm-card lb-card">
        {!n && <p>No matches yet. Be the first: tap Battle.</p>}
        {n > 0 && !rows.length && <p>Loading ratings from NEAR…</p>}
        <ol className="lb-list">
          {rows.map((row, i) => (
            <li key={row.p} className={`${row.p === me ? "me" : ""} ${i < 3 ? `top top-${i + 1}` : ""}`}>
              <span className="lb-rank">{i < 3 ? ["🥇", "🥈", "🥉"][i] : i + 1}</span>
              <span className="lb-who">{row.p === me ? "You" : short(row.p)}<small>{row.w}W · {row.l}L{row.d ? ` · ${row.d}D` : ""}</small></span>
              <b className="lb-rating">{row.r}</b>
            </li>
          ))}
        </ol>
      </section>
      <p className="qm-foot">Elo ratings stored onchain in the game contract · {n} matches</p>
    </div>
  );
}
