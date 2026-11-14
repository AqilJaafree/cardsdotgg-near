"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Flag, Settings, Swords, Trophy, X, Zap } from "lucide-react";
import BattleBoard, { Energy } from "./BattleBoard";
import { AttackChoices, AttackCinematic, BattleOpening } from "./BattleChoreography";
import type { EffectEvent } from "./BattleEffects";
import { readable } from "@/components/TxButton";
import { QuickPlay } from "./QuickPlay";
import ReplayBattle from "./ReplayBattle";
import { SettingsSheet } from "./SettingsSheet";
import { A, type MatchJson } from "@/lib/contracts";
import { battleTiming, type AttackCue } from "@/lib/game/choreography";
import { catalog } from "@/lib/game/catalog";
import { ATTACH, ATTACK, POWER, POWER_COST, RETREAT_COST, TURN_SECS, creature, defaultArt, describe, estimate, retreat, skinOf, stage, type DuelCard, type DuelJson, type DuelLog, type DuelSide, type Move } from "@/lib/game/duel";
import type { BattleState, Fighter } from "@/lib/game/simulation";
import { imgFor, toBoard } from "@/lib/game/duelView";
import { enableSound, sound } from "@/lib/game/sound";
import { TGAS } from "@/lib/near";
import { useView } from "@/lib/useView";
import { useWallet } from "@/lib/wallet";

const CardTheater = dynamic(() => import("./CardTheater"), { ssr: false });
const short = (a?: string | null) => (a ? (a.length > 14 ? `${a.slice(0, 7)}…${a.slice(-4)}` : a) : "");
const mm = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * The real, onchain duel on the practice screen: same board, opening, attack cinematics and result as practice mode.
 * The board is driven by `get_duel`. Every move in the contract's log (yours and your opponent's) plays as an
 * animation, and a whole turn is sent in one transaction.
 */
export default function OnlineBattle({ match, me, onLeave }: { match: MatchJson; me: string; onLeave: () => void }) {
  const mySide = match.player_a === me ? 0 : 1;
  const foe = mySide === 0 ? match.player_b : match.player_a;
  const { call, session } = useWallet();
  const router = useRouter();
  const duel = useView<DuelJson>(A.game, "get_duel", { match_id: match.id }, { interval: match.status === 3 ? undefined : 5000 });

  const [shown, setShown] = useState<DuelJson>();              // what the board shows (catches up with the chain as animations play)
  const [phase, setPhase] = useState<"loading" | "opening" | "battle" | "result">("loading");
  const [openingStage, setOpeningStage] = useState("versus");
  const [moves, setMoves] = useState<Move[]>([]);
  const [busy, setBusy] = useState(false), [animating, setAnimating] = useState(false);
  const [banner, setBanner] = useState(""), [err, setErr] = useState("");
  const [attack, setAttack] = useState<"player" | "opponent">(), [cue, setCue] = useState<AttackCue & { move: string; title: string }>();
  const [effect, setEffect] = useState<EffectEvent>(), [knockout, setKnockout] = useState<"player" | "opponent">(), [swapping, setSwapping] = useState(false);
  const [point, setPoint] = useState<"player" | "opponent" | null>(null);
  const [choices, setChoices] = useState(false), [inspect, setInspect] = useState<number[] | null>(null), [confirmExit, setConfirmExit] = useState(false);
  const [audio, setAudio] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [replay, setReplay] = useState(false), [claimed, setClaimed] = useState(false);
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000));

  const latest = useRef<DuelJson>(), processed = useRef<number | null>(null), queue = useRef<DuelLog[]>([]), running = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wait = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  useEffect(() => { const t = setInterval(() => setClock(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);

  const burst = (kind: EffectEvent["kind"], target: EffectEvent["target"], amount?: number) => setEffect({ id: Date.now(), kind, target, amount });
  const sideName = (s: number): "player" | "opponent" => (s === mySide ? "player" : "opponent");

  /** Say whose turn it is, then clear the banner. */
  const announce = (d: DuelJson) => {
    if (d.winner !== null) return;
    setBanner(d.mover === mySide ? "Your turn" : "Your opponent’s turn"); sound("turn");
    wait(battleTiming.turn, () => setBanner(""));
  };

  /** Play the next unseen move from the contract's log, then the one after it. */
  function next() {
    const e = queue.current.shift();
    const d = latest.current!;
    if (!e) {
      running.current = false; setAnimating(false); setShown(d);
      if (d.winner !== null) { setPhase("result"); if (d.winner === mySide) { burst("victory", "player"); sound("rare"); } } else announce(d);
      return;
    }
    running.current = true; setAnimating(true);
    const who = sideName(e.side), against = who === "player" ? "opponent" : "player";
    if (e.action === 0) { burst("energy", who); sound("turn"); wait(battleTiming.energy, next); return; }
    if (e.action === 3) { setSwapping(true); sound("flip"); wait(battleTiming.swap / 2, () => setShown(d)); wait(battleTiming.swap, () => { setSwapping(false); next(); }); return; }
    const strong = e.action === 2;
    const c = creature(e.card);
    setCue({ id: Date.now(), cardId: imgFor(d.sides[e.side], e.card), side: who, tier: d.sides[e.side].tier, strong, move: c.ability, title: c.name }); sound("flip");
    wait(battleTiming.attackImpact - 300, () => setAttack(who));
    wait(battleTiming.attackImpact, () => {
      setCue(undefined); setAttack(undefined); setShown(d);
      if (e.dodged || e.damage === 0) { setBanner(e.dodged ? "Dodged!" : "Blocked!"); wait(1100, () => setBanner("")); }
      else { burst("hit", against, e.damage); sound("hit"); }
      if (e.ko) {
        setKnockout(against); wait(battleTiming.knockout, () => setKnockout(undefined));
        wait(battleTiming.pointStart - battleTiming.attackImpact, () => { setPoint(who); sound("rare"); });
        wait(battleTiming.pointEnd - battleTiming.attackImpact, () => setPoint(null));
      }
      wait(e.ko ? battleTiming.pointEnd - battleTiming.attackImpact + 200 : battleTiming.attackRecover - battleTiming.attackImpact, next);
    });
  }

  // Every time fresh duel data arrives: show it as is on the first load, afterwards animate the moves we have not seen.
  useEffect(() => {
    const d = duel.data;
    if (!d) return;
    latest.current = d;
    if (processed.current === null) {
      processed.current = d.log.length; setShown(d);
      setPhase(d.winner !== null ? "result" : d.log.length === 0 ? "opening" : "battle");
      return;
    }
    const fresh = d.log.slice(processed.current);
    processed.current = d.log.length;
    if (fresh.length) { queue.current.push(...fresh); if (!running.current) next(); }
    else if (!running.current) {
      setShown(d);
      // A forfeit or a timeout ends the duel without adding a move to the log, so the result has to be shown from here.
      if (d.winner !== null) { setPhase("result"); if (d.winner === mySide) { burst("victory", "player"); sound("rare"); } }
    }
  }, [duel.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMoves([]); }, [shown?.turn]);

  /** Claim rewards: collects the deck's yield and, if quick play is on, closes it in the same wallet approval. */
  const finish = async () => {
    setErr("");
    try {
      const claim = () => session.endWith({ receiverId: A.game, methodName: "checkpoint", args: { deck_id: mySide === 0 ? match.deck_a : match.deck_b }, gas: TGAS(30) });
      let r;
      try { r = await claim(); }
      catch (e) { // the free RPC briefly refuses when it is busy: wait a moment and try once more
        if (!/429|rate limit/i.test(String((e as Error)?.message ?? e))) throw e;
        await new Promise((res) => setTimeout(res, 2500)); r = await claim();
      }
      if (r.failure) setErr(readable(r.failure));
      else { setClaimed(true); wait(1200, () => router.push("/")); } // show "Rewards claimed" briefly, then back to the menu
    } catch (e) { setErr(readable((e as Error)?.message ?? String(e))); } // declined: the session stays on
  };
  const startBattle = () => { setPhase("battle"); if (latest.current) announce(latest.current); };
  const send = useCallback(async (name: string, args: object, gas = 120) => {
    setBusy(true); setErr("");
    try {
      const r = await call({ receiverId: A.game, methodName: name, args, gas: TGAS(gas) });
      if (r.failure) throw new Error(r.failure);
      setMoves([]); await duel.refetch();
    } catch (e) { setErr(readable((e as Error)?.message ?? String(e))); }
    finally { setBusy(false); }
  }, [call, duel]);

  if (!shown) return <div className="arena-page game-fullscreen game-menu"><p className="duel-loading">Loading the duel…</p></div>;
  if (replay) return <ReplayBattle duel={shown} match={match} mySide={mySide} onClose={() => setReplay(false)} />;

  const mine = stage(shown.sides[mySide], moves);
  const theirs = shown.sides[1 - mySide];
  const state = toBoard(shown, mySide, mine);
  const inBattle = phase === "battle";
  const myTurn = shown.mover === mySide && shown.winner === null;
  const attached = shown.energy_used || moves.some((m) => m[0] === 0);
  const retreated = shown.retreated || moves.some((m) => m[0] === 3);
  const left = Math.max(0, shown.last_move_at + TURN_SECS - clock);
  const locked = busy || animating;
  const tier = shown.sides[mySide].tier;
  const canAct = inBattle && myTurn && !locked;
  const basic = estimate(mine.active, theirs.active, false), power = estimate(mine.active, theirs.active, true);
  const nudge = (text: string) => { setBanner(text); wait(1500, () => setBanner("")); };

  const doAttack = (strong: boolean) => { if (!canAct) return; setChoices(false); send("play_turn", { match_id: match.id, moves: [...moves, strong ? POWER : ATTACK] }); };
  const energy = () => { if (!canAct || attached) return; burst("energy", "player"); sound("turn"); setMoves([...moves, ATTACH]); };
  const switchCard = (i: number) => {
    if (!canAct) { if (!locked) setInspect([imgFor(mine, mine.bench[i].id)]); return; }
    if (retreated) return nudge("One retreat per turn");
    if (mine.active.energy < RETREAT_COST) return nudge("Retreat costs 1 Energy");
    setSwapping(true); sound("flip");
    wait(battleTiming.swap / 2, () => setMoves([...moves, retreat(i)]));
    wait(battleTiming.swap, () => setSwapping(false));
  };
  const status = phase === "result" ? "MATCH COMPLETE" : phase === "opening" ? "YOUR LINEUP" : locked ? "RESOLVING MOVE" : myTurn ? `YOUR TURN · ${mm(left)}` : `THEIR TURN · ${mm(left)}`;
  const statusKind = phase === "result" ? "over" : phase === "opening" ? "idle" : locked ? "busy" : myTurn ? "mine" : "theirs";
  const won = shown.winner === mySide, draw = shown.winner === 2;
  // A forfeit or a timeout ends the duel before anyone reaches 3 points.
  const endedEarly = shown.winner !== null && shown.winner !== 2 && shown.sides[shown.winner].points < 3;

  return (
    <div className="arena-page game-fullscreen online">
      <div className="arena-layout">
        <section className="arena-center">
          <div className="match-toolbar">
            <span><Swords size={14} />Online duel</span>
            <span className={`match-status st-${statusKind}`}><i />{status}</span>
            <button className="ob-tool ob-icon" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings size={17} /></button>
          </div>
          <div className="board-surround">
            <BattleBoard state={state} tier={tier} opponentName={short(foe) || "Opponent"} opponentTag="Online player" phase={phase === "loading" ? "ready" : phase}
              onInspect={setInspect} onBench={switchCard} onActive={() => { if (canAct) setChoices(true); else if (!locked) setInspect([state.player.active.id]); }}
              openingStage={openingStage} knockout={knockout} swapping={swapping} banner={banner} attack={attack} effect={effect}>
              {phase === "opening" && <BattleOpening opponent={short(foe) || "Opponent"} onDone={startBattle} onStage={setOpeningStage} />}
              {cue && <AttackCinematic cue={cue} move={cue.move} title={cue.title} />}
              {choices && <AttackChoices unit={state.player.active} tier={tier} basic={basic} power={power} powerCost={POWER_COST} move={creature(mine.active.id).ability}
                onAttack={doAttack} onClose={() => setChoices(false)} onInspect={() => { setChoices(false); setInspect([state.player.active.id]); }} />}
              {point && <div className={`point-overlay ${point}`}><div className="point-medal"><Trophy size={28} /></div><h2>+1 point!</h2><div className="point-ribbon" /><p>{point === "player" ? "YOU" : short(foe)}</p><div className="big-score">{[0, 1, 2].map((i) => <span key={i} className={state[point].points > i ? "won" : ""}>{i + 1}</span>)}</div></div>}
              {phase === "result" && (
                <div className="result-overlay"><div className="result-glow" /><span className="eyebrow">MATCH #{match.id} COMPLETE</span><Trophy size={45} />
                  <h2>{draw ? "Draw." : won ? "Victory!" : "Well played."}</h2>
                  <p>{draw ? "Evenly matched." : won ? "Settled onchain. The win is yours." : "Every battle is a chance to grow."}</p>
                  <img src={cardImg(state.player.active.id)} alt="" />
                  <div className="ob-score" role="group" aria-label={`Final score: you ${state.player.points}, ${short(foe)} ${state.opponent.points}`}>
                    <div><small>YOU</small><b>{state.player.points}</b></div><span>—</span><div><small>{short(foe) || "OPPONENT"}</small><b>{state.opponent.points}</b></div>
                  </div>
                  <p className="ob-reason">{endedEarly ? (won ? "Your opponent forfeited or ran out of time." : "You forfeited or ran out of time.") : "Each knocked-out card is 1 point. First to 3 wins."}</p>
                  <div className="ob-dock">
                    <button className="ob-primary" disabled={session.busy || claimed} onClick={finish}>{claimed ? "Rewards claimed ✓" : session.busy ? "Waiting for your wallet…" : "Claim rewards"}</button>
                    <div className="ob-dock-row">
                      <button className="ob-secondary" onClick={() => setReplay(true)}>Replay</button>
                      <button className="ob-play" onClick={onLeave}>Play again</button>
                    </div>
                  </div>
                  {(err || session.error) && <small role="alert" className="ob-reason">{err || session.error}</small>}
                </div>
              )}
            </BattleBoard>
          </div>
          {phase !== "result" && (myTurn || locked ? (
            <div className="battle-controls ob-controls">
              <button className="ob-btn ob-energy" disabled={!canAct || attached || mine.active.energy >= 5} onClick={energy}>
                <span><Energy tier={tier} /><b>Attach<span className="ob-xs-hide"> Energy</span></b></span>
                <small>{attached ? "Done this turn" : mine.active.energy >= 5 ? "Already full" : `+1 Energy · ${mine.active.energy}/5`}</small>
              </button>
              <button className="ob-btn ob-attack" disabled={!canAct || mine.active.energy < 1} onClick={() => doAttack(false)}>
                <span><Swords size={16} /><b>Attack</b></span>
                <small>{mine.active.energy < 1 ? "Needs 1 Energy" : `~${basic} damage`}</small>
              </button>
              <button className="ob-btn ob-power" disabled={!canAct || mine.active.energy < POWER_COST} onClick={() => doAttack(true)}>
                <span><Zap size={16} /><b>Power</b></span>
                <small>{mine.active.energy < POWER_COST ? `Needs ${POWER_COST} Energy` : `~${power} damage`}</small>
              </button>
            </div>
          ) : shown.winner === null && inBattle ? (
            <div className="battle-controls ob-wait">
              <div className="ob-waitbar"><i />{short(foe) || "Your opponent"} is choosing a move<small>{left > 0 ? `${mm(left)} left` : "out of time"}</small></div>
              {left === 0 && !locked && <button className="ob-btn ob-attack ob-claim" onClick={() => send("claim_timeout", { match_id: match.id }, 60)}><span><b>Claim win</b></span><small>they ran out of time</small></button>}
            </div>
          ) : null)}
          {inBattle && myTurn && !locked && (
            <p className="ob-caption">
              {moves.length > 0
                ? <>Lined up: {moves.map((m) => (m[0] === 0 ? "Attach Energy" : "Retreat")).join(" → ")} <button className="ob-link" onClick={() => setMoves([])}>Undo</button></>
                : <>Tap a bench card to retreat · costs 1 Energy</>}
            </p>
          )}
          {inBattle && !session.active && <QuickPlay />}
          {err && <p className="duel-err" role="alert" onClick={() => setErr("")}>{err}</p>}
        </section>
      </div>
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} sound={{ on: audio, toggle: () => { setAudio(!audio); enableSound(!audio); } }} inDuel={phase !== "result"}
        onForfeit={phase === "battle" && !busy ? () => { setSettingsOpen(false); setConfirmExit(true); } : undefined} />}
      {inspect && <CardTheater ids={inspect} title="A closer look" inspection onDone={() => setInspect(null)} />}
      {confirmExit && (
        <div className="modal-backdrop"><section className="confirmation" role="dialog" aria-modal="true" aria-label="Forfeit match">
          <button className="round-button dismiss" onClick={() => setConfirmExit(false)} aria-label="Close"><X size={18} /></button>
          <Flag size={28} /><h2>Forfeit this match?</h2><p>Quitting counts as a loss. Your opponent wins and the stake settles.</p>
          <div className="ob-dialog-actions">
            <button className="ob-danger" onClick={() => { setConfirmExit(false); send("forfeit", { match_id: match.id }, 60); }}>Forfeit</button>
            <button className="ob-secondary" onClick={() => setConfirmExit(false)}>Keep playing</button>
          </div>
        </section></div>
      )}
    </div>
  );
}

const cardImg = (id: number) => catalog.find((c) => c.id === id)?.src ?? "";
