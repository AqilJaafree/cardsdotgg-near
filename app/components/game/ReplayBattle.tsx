"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward, Trophy, X } from "lucide-react";
import BattleBoard from "./BattleBoard";
import { AttackCinematic } from "./BattleChoreography";
import type { EffectEvent } from "./BattleEffects";
import type { MatchJson } from "@/lib/contracts";
import { battleTiming, type AttackCue } from "@/lib/game/choreography";
import { creature, describe, type DuelJson } from "@/lib/game/duel";
import { buildFrames, imgFor, toBoard } from "@/lib/game/duelView";
import { sound } from "@/lib/game/sound";

const short = (a?: string | null) => (a ? (a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-4)}` : a) : "");

/**
 * Watch a match back on the same board as the live duel: every move of the contract's log plays with the same
 * attack cinematics, hits, knockouts and points. Play / Pause, Next move and Restart.
 */
export default function ReplayBattle({ duel, match, mySide, onClose }: { duel: DuelJson; match: MatchJson; mySide: number; onClose: () => void }) {
  const frames = useMemo(() => buildFrames(duel), [duel]);
  const total = duel.log.length;
  const foe = mySide === 0 ? match.player_b : match.player_a;
  const names = [short(match.player_a), short(match.player_b)];

  const [idx, setIdx] = useState(0);                       // how many moves have landed on the board
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState("");
  const [attack, setAttack] = useState<"player" | "opponent">();
  const [cue, setCue] = useState<AttackCue & { move: string; title: string }>();
  const [effect, setEffect] = useState<EffectEvent>();
  const [knockout, setKnockout] = useState<"player" | "opponent">();
  const [swapping, setSwapping] = useState(false);
  const [point, setPoint] = useState<"player" | "opponent" | null>(null);

  const idxRef = useRef(0), busyRef = useRef(false), playingRef = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]), gen = useRef(0);
  const wait = (ms: number, fn: () => void) => { const g = gen.current; timers.current.push(setTimeout(() => { if (g === gen.current) fn(); }, ms)); };
  const clear = () => { gen.current++; timers.current.forEach(clearTimeout); timers.current = []; };
  useEffect(() => () => clear(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sideName = (s: number): "player" | "opponent" => (s === mySide ? "player" : "opponent");
  const burst = (kind: EffectEvent["kind"], target: EffectEvent["target"], amount?: number) => setEffect({ id: Date.now(), kind, target, amount });
  const land = (i: number) => { idxRef.current = i + 1; setIdx(i + 1); };

  /** Animate move `i` and land the board on frame i+1; `then` runs when the animation has finished. */
  function playMove(i: number, then: () => void) {
    const e = duel.log[i];
    busyRef.current = true; setBusy(true);
    const done = () => { busyRef.current = false; setBusy(false); then(); };
    const who = sideName(e.side), against = who === "player" ? "opponent" : "player";
    if (e.action === 0) { burst("energy", who); sound("turn"); land(i); wait(battleTiming.energy, done); return; }
    if (e.action === 3) { setSwapping(true); sound("flip"); wait(battleTiming.swap / 2, () => land(i)); wait(battleTiming.swap, () => { setSwapping(false); done(); }); return; }
    const c = creature(e.card);
    setCue({ id: Date.now(), cardId: imgFor(frames[i].sides[e.side], e.card), side: who, tier: frames[i].sides[e.side].tier, strong: e.action === 2, move: c.ability, title: c.name }); sound("flip");
    wait(battleTiming.attackImpact - 300, () => setAttack(who));
    wait(battleTiming.attackImpact, () => {
      setCue(undefined); setAttack(undefined); land(i);
      if (e.dodged || e.damage === 0) { setBanner(e.dodged ? "Dodged!" : "Blocked!"); wait(1100, () => setBanner("")); }
      else { burst("hit", against, e.damage); sound("hit"); }
      if (e.ko) {
        setKnockout(against); wait(battleTiming.knockout, () => setKnockout(undefined));
        wait(battleTiming.pointStart - battleTiming.attackImpact, () => { setPoint(who); sound("rare"); });
        wait(battleTiming.pointEnd - battleTiming.attackImpact, () => setPoint(null));
      }
      wait(e.ko ? battleTiming.pointEnd - battleTiming.attackImpact + 200 : battleTiming.attackRecover - battleTiming.attackImpact, done);
    });
  }

  /** Keep playing from move `i` until the end or until Pause. */
  function run(i: number) {
    if (i >= total) { playingRef.current = false; setPlaying(false); if (duel.winner === mySide) { burst("victory", "player"); sound("rare"); } return; }
    playMove(i, () => { if (playingRef.current) run(i + 1); });
  }
  const start = () => { playingRef.current = true; setPlaying(true); if (!busyRef.current) run(idxRef.current); };
  const restart = () => {
    clear(); busyRef.current = false; setBusy(false); setCue(undefined); setAttack(undefined); setPoint(null); setKnockout(undefined); setSwapping(false); setBanner("");
    idxRef.current = 0; setIdx(0); start();
  };
  const toggle = () => {
    if (playingRef.current) { playingRef.current = false; setPlaying(false); return; }
    if (idxRef.current >= total) restart(); else start();
  };
  const nextMove = () => { if (busyRef.current || idxRef.current >= total) return; playingRef.current = false; setPlaying(false); playMove(idxRef.current, () => {}); };

  // Start by itself shortly after opening (the timer is cleared if the screen closes first).
  useEffect(() => { const t = setTimeout(() => { if (!busyRef.current && idxRef.current === 0) start(); }, 700); return () => clearTimeout(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const frame = frames[idx];
  const state = toBoard(frame, mySide, frame.sides[mySide]);
  const last = idx > 0 ? duel.log[idx - 1] : undefined;
  const finished = idx >= total && !busy;

  return (
    <div className="arena-page game-fullscreen online">
      <div className="arena-layout">
        <section className="arena-center">
          <div className="match-toolbar">
            <span>Replay · #{match.id}</span>
            <span className="match-status st-idle"><i />{finished ? "REPLAY DONE" : `MOVE ${Math.min(idx + (busy ? 1 : 0), total)} / ${total}`}</span>
            <button className="ob-tool ob-icon" onClick={onClose} aria-label="Close replay"><X size={17} /></button>
          </div>
          <div className="board-surround">
            <BattleBoard state={state} tier={frame.sides[mySide].tier} opponentName={short(foe) || "Opponent"} opponentTag="Replay" phase="battle"
              onInspect={() => {}} openingStage="deal" knockout={knockout} swapping={swapping} banner={banner} attack={attack} effect={effect}>
              {cue && <AttackCinematic cue={cue} move={cue.move} title={cue.title} />}
              {point && <div className={`point-overlay ${point}`}><div className="point-medal"><Trophy size={28} /></div><h2>+1 point!</h2><div className="point-ribbon" /><p>{point === "player" ? "YOU" : short(foe)}</p><div className="big-score">{[0, 1, 2].map((n) => <span key={n} className={state[point].points > n ? "won" : ""}>{n + 1}</span>)}</div></div>}
            </BattleBoard>
          </div>
          <div className="battle-controls ob-controls">
            <button className="ob-btn ob-cream" onClick={restart}><span><RotateCcw size={16} /><b>Restart</b></span></button>
            <button className="ob-btn ob-attack" onClick={toggle}><span>{playing ? <Pause size={16} /> : <Play size={16} />}<b>{playing ? "Pause" : finished ? "Watch again" : "Play"}</b></span></button>
            <button className="ob-btn ob-cream" disabled={busy || idx >= total} onClick={nextMove}><span><SkipForward size={16} /><b>Next</b></span></button>
          </div>
          <p className="ob-caption">{last ? describe(last, names[last.side]) : "Press Play to watch the match."}</p>
        </section>
      </div>
    </div>
  );
}
