"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import OnlineBattle, { type LocalGame } from "./OnlineBattle";
import { A, type MatchJson } from "@/lib/contracts";
import type { DeckCardsJson, DuelJson, Move } from "@/lib/game/duel";
import { computerTurn, concede, newDuel, play as applyMove, starterSetup, type Setup } from "@/lib/game/duelEngine";
import { STARTER_PICS, hpBonus, useCollection } from "@/lib/game/useCollection";
import { useDecks } from "@/lib/useDecks";
import { useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";

/** A stand-in match record: practice has no onchain match, but the battle screen wants one for names and the replay. */
const PRACTICE_MATCH: MatchJson = { id: "practice", deck_a: "0", deck_b: "0", player_a: "you", player_b: "Computer", opponent: null, stake_a: "0", stake_b: "0", seed: null, status: 2, created_at: "0", seed_block: "0", winner: null };

/**
 * Practice: the real duel rules against the computer, with your own saved deck (your unlocked creatures, pictures and
 * perks) when you are signed in and have a deck of this type, otherwise the starter deck. Nothing is sent to the chain.
 */
export default function PracticeBattle({ tier, onExit }: { tier: number; onExit: () => void }) {
  const { accountId } = useWallet();
  const { decks, loaded } = useDecks(false);
  const mine = decks.find((d) => !d.retired && d.tier === tier);
  const saved = useView<DeckCardsJson>(A.game, "get_deck_cards", mine ? { deck_id: String(mine.id) } : undefined, { enabled: !!mine });
  const col = useCollection();
  const ready = !accountId || (loaded && (!mine || saved.data !== undefined || !!saved.error));

  // Your deck: the saved cards and pictures, with the HP perk of each picture unlocked from a pack.
  const setup: Setup = useMemo(() => {
    const d = saved.data;
    if (!d) return starterSetup(tier);
    return { lineup: d.cards, art: d.art, perk: d.art.map((a) => (a > 0 && col.pictures.has(a) && !STARTER_PICS.has(a) ? hpBonus(a) : 0)), tier };
  }, [saved.data, col.pictures, tier]);

  const [round, setRound] = useState(0);
  const [game, setGame] = useState<DuelJson>();
  const ref = useRef<DuelJson>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const set = (d: DuelJson) => { ref.current = d; setGame(d); };

  // A new game whenever the deck, the opponent or the round changes. The computer plays a different deck type each round.
  const foeTier = (tier + 1 + (round % 2)) % 3;
  useEffect(() => {
    if (!ready) return;
    clearTimeout(timer.current);
    set(newDuel(setup, starterSetup(foeTier)));
    return () => clearTimeout(timer.current);
  }, [ready, round, foeTier]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The computer takes its whole turn, a moment after the player's. The battle screen plays the new moves one by one. */
  function computerMove() {
    let d = ref.current;
    if (!d || d.winner !== null || d.mover !== 1) return;
    for (const m of computerTurn(d, 1)) {
      const r = applyMove(d, m);
      if ("refused" in r) break;
      d = r.duel;
      if (d.winner !== null) break;
    }
    set(d);
  }
  const scheduleComputer = (ms: number) => { clearTimeout(timer.current); timer.current = setTimeout(computerMove, ms); };

  const local: LocalGame | undefined = game && {
    duel: game,
    play(moves: Move[]) {
      let d = ref.current!;
      for (const m of moves) {
        const r = applyMove(d, m);
        if ("refused" in r) return r.refused;
        d = r.duel;
        if (d.winner !== null) break;
      }
      set(d);
      if (d.winner === null && d.mover === 1) scheduleComputer(1200);
    },
    forfeit() { clearTimeout(timer.current); set(concede(ref.current!, 0)); },
    onStart() { if (ref.current?.mover === 1) scheduleComputer(900); },
    onExit,
  };

  if (!game || !local) return <div className="arena-page game-fullscreen game-menu"><p className="duel-loading">Getting your deck ready…</p></div>;
  return <OnlineBattle key={round} match={PRACTICE_MATCH} me="you" local={local} onLeave={() => { clearTimeout(timer.current); ref.current = undefined; setGame(undefined); setRound((r) => r + 1); }} />;
}
