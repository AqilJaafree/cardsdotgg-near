"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Gate } from "@/components/NotDeployed";
import { A, cards, fmtUsd, STATUS, TIERS, type DeckJson, type MatchJson } from "@/lib/contracts";
import { useView } from "@/lib/useView";

const KIND = ["attacks", "heals", "swaps", "enters"];
type Action = { round: number; side: number; slot: number; target_slot: number; card_id: number; damage: number; crit: boolean; dodged: boolean; target_hp_after: number; self_hp_after: number; kind: number; target_card_id: number };

export default function Match() {
  const id = useParams<{ id: string }>().id;
  const m = useView<MatchJson | null>(A.game, "get_match", { match_id: id }).data ?? undefined;
  const resolved = !!m && m.status === 3;
  const dA = useView<DeckJson | null>(A.game, "get_deck", { deck_id: m?.deck_a ?? "0" }, { enabled: !!m }).data ?? undefined;
  const dB = useView<DeckJson | null>(A.game, "get_deck", { deck_id: m?.deck_b ?? "0" }, { enabled: !!m }).data ?? undefined;
  const ready = resolved && !!dA && !!dB && !!m?.seed;
  const args = ready ? { seed: m!.seed, tier_a: dA!.tier, tier_b: dB!.tier } : undefined;
  const log = useView<Action[]>(A.game, "simulate_with_log", args, { enabled: ready });
  const sim = useView<{ winner_side: number }>(A.game, "simulate", args, { enabled: ready });
  const actions = log.data ?? [];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!actions.length) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(actions.length); return; }
    setShown(0);
    const t = setInterval(() => setShown((s) => (s >= actions.length ? s : s + 1)), 350);
    return () => clearInterval(t);
  }, [actions.length]);

  let verdict: React.ReactNode = null;
  if (sim.data && m) {
    const side = sim.data.winner_side;
    const replayWinner = side === 0 ? m.player_a : side === 1 ? m.player_b : null;
    const ok = replayWinner === m.winner;
    verdict = ok ? <p>✓ Replay winner matches the onchain result.</p> : <p className="err">✗ MISMATCH: replay winner {replayWinner ?? "draw"} vs onchain {m.winner ?? "draw"}</p>;
  }
  const name = (c: number) => cards[c]?.name ?? `#${c}`;
  return (
    <Gate>
      <div className="card">
        <h2>Match #{id} · {m ? STATUS[m.status] : "…"}</h2>
        <small>prototype-only randomness (block random seed). Replay is the contract's own simulate_with_log output.</small>
        {m && <p>{dA && TIERS[dA.tier]} (deck #{m.deck_a}) vs {dB && TIERS[dB.tier]} (deck #{m.deck_b}) · stakes {fmtUsd(BigInt(m.stake_a))} / {fmtUsd(BigInt(m.stake_b))} tUSD · winner {m.status === 3 ? (m.winner ?? "draw") : "…"}</p>}
        {!resolved && m && <p>Not resolved yet.</p>}
        {verdict}
        {log.error && <p className="err">Replay call failed: {log.error.message.slice(0, 200)}</p>}
        <p><small>Rating changes and stake settlement appear in Arena ratings and your deck escrow.</small></p>
      </div>
      <div className="card">
        {actions.slice(0, shown).map((a, i) => (
          <div key={i}>R{a.round} · side {a.side ? "B" : "A"}: {name(a.card_id)} {KIND[a.kind] ?? "acts"}
            {a.kind === 0 && <> {name(a.target_card_id)} for {a.damage}{a.crit ? " (crit)" : ""}{a.dodged ? " (dodged)" : ""} → HP {a.target_hp_after}</>}
            {a.kind === 1 && <> {name(a.target_card_id)} → HP {a.target_hp_after}</>}
          </div>
        ))}
      </div>
    </Gate>
  );
}
