"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Gamepad2, Sparkles, Ticket } from "lucide-react";
import { GameScreen, ARCADE_TABS } from "./GameScreen";
import { isCancel, readable } from "@/components/TxButton";
import { A } from "@/lib/contracts";
import { ONE_YOCTO, TGAS } from "@/lib/near";
import { useWallet } from "@/lib/wallet";
import { ARCADE, fetchTickets, landed, useTickets, type TicketsJson } from "@/lib/game/arcade";
import { sound } from "@/lib/game/sound";

// ---------------------------------------------------------------- Stacker (free play)

const COLS = 7, ROWS = 9;

/** Stop the sliding row so it lands on the one below; overhang falls off. Reach the top row to win. About 15 seconds. */
function Stacker({ onDone }: { onDone: (won: boolean) => void }) {
  const [rows, setRows] = useState<[number, number][]>([]);  // locked rows: [left, width]
  const [cur, setCur] = useState({ l: 0, w: 3 });
  const [over, setOver] = useState<null | boolean>(null);
  // `shown` is the column last drawn on screen: STOP locks exactly that, never a position the player has not seen yet.
  const pos = useRef(0), dir = useRef(1), rowsRef = useRef(rows), curW = useRef(3), live = useRef(true), shown = useRef(0);
  rowsRef.current = rows;

  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (live.current) {
        const speed = 3 + rowsRef.current.length * 0.5;            // cells per second: 3 at the bottom, 7 at the top
        const max = COLS - curW.current;
        pos.current += dir.current * speed * dt;
        if (pos.current > max) { pos.current = max; dir.current = -1; }
        if (pos.current < 0) { pos.current = 0; dir.current = 1; }
        shown.current = Math.round(pos.current);
        setCur({ l: shown.current, w: curW.current });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const stop = useCallback(() => {
    if (!live.current) return;
    const l = shown.current, w = curW.current, below = rowsRef.current.at(-1);
    const [ol, ow] = below ? [Math.max(l, below[0]), Math.min(l + w, below[0] + below[1]) - Math.max(l, below[0])] : [l, w];
    if (ow <= 0) { live.current = false; setOver(false); sound("flip"); setTimeout(() => onDone(false), 900); return; }
    const next: [number, number][] = [...rowsRef.current, [ol, ow]];
    setRows(next); sound("flip");
    if (next.length === ROWS) { live.current = false; setOver(true); sound("rare"); setTimeout(() => onDone(true), 900); return; }
    curW.current = ow; pos.current = dir.current > 0 ? 0 : COLS - ow; shown.current = Math.round(pos.current);
  }, [onDone]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); stop(); } };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [stop]);

  const filled = (r: number, c: number) => {
    const lk = rows[r];
    if (lk) return c >= lk[0] && c < lk[0] + lk[1] ? "lock" : "";
    if (r === rows.length && over === null) return c >= cur.l && c < cur.l + cur.w ? "live" : "";
    return "";
  };
  return <div className="arc-game">
    <div className="arc-stack" onPointerDown={stop} role="button" aria-label="Stop the row" tabIndex={0}>
      {Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i).map((r) => <div key={r} className={`arc-row ${r === ROWS - 1 ? "top" : ""}`}>
        {Array.from({ length: COLS }, (_, c) => <i key={c} className={filled(r, c)} />)}
      </div>)}
      {over !== null && <div className={`arc-flash ${over ? "win" : "lose"}`}>{over ? "TOP!" : "MISSED!"}</div>}
    </div>
    <button className="cm-btn cm-play qm-btn" onPointerDown={(e) => { e.preventDefault(); stop(); }} onClick={(e) => { if (e.detail === 0) stop(); }} disabled={over !== null}>STOP</button>
    <p className="arc-hint">Tap the board, STOP or Space. Row {Math.min(rows.length + 1, ROWS)} of {ROWS}</p>
  </div>;
}

// ---------------------------------------------------------------- Claw (paid play)

type Capsule = { x: number; hue: number };
/** Capsule radius (20px) plus 10px grace: the hook's centre must be this close to a capsule's centre. */
const HIT_PX = 30;

/** Time the drop so the claw closes on a capsule. One try. About 10 seconds. */
function Claw({ onDone }: { onDone: (won: boolean) => void }) {
  const [caps] = useState<Capsule[]>(() => {
    const xs: number[] = [];
    while (xs.length < 3) { const x = 14 + Math.random() * 72; if (xs.every((o) => Math.abs(o - x) > 18)) xs.push(x); }
    return xs.map((x, i) => ({ x, hue: [200, 330, 45][i] }));
  });
  const [x, setX] = useState(50), [phase, setPhase] = useState<"aim" | "drop" | "lift" | "done">("aim"), [got, setGot] = useState<number | null>(null);
  // `shown` is the claw position last drawn; the hit test uses it, measured in pixels against the drawn capsule.
  const pos = useRef(50), dir = useRef(1), aiming = useRef(true), shown = useRef(50), box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (aiming.current) {
        pos.current += dir.current * 34 * dt;                     // % of the cabinet per second: about 2.5 s edge to edge
        if (pos.current > 92) { pos.current = 92; dir.current = -1; }
        if (pos.current < 8) { pos.current = 8; dir.current = 1; }
        shown.current = pos.current;
        setX(pos.current);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const drop = useCallback(() => {
    if (!aiming.current) return;
    aiming.current = false; setPhase("drop"); sound("flip");
    // A grab when the hook's centre is within the capsule's radius plus a little grace (20px + 10px), as drawn.
    const width = box.current?.clientWidth || 372, at = shown.current;
    const hit = caps.findIndex((c) => (Math.abs(c.x - at) / 100) * width <= HIT_PX);
    setTimeout(() => { setGot(hit >= 0 ? hit : null); setPhase("lift"); }, 700);
    setTimeout(() => { setPhase("done"); sound(hit >= 0 ? "rare" : "flip"); setTimeout(() => onDone(hit >= 0), 900); }, 1500);
  }, [caps, onDone]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); drop(); } };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [drop]);

  return <div className="arc-game">
    <div className="arc-claw" ref={box} onPointerDown={drop} role="button" aria-label="Drop the claw" tabIndex={0}>
      <div className="arc-rail" />
      <div className={`arc-grab ${phase}`} style={{ left: `${x}%` }}>
        <span className="arc-cable" />
        <span className="arc-hook" />
        {got !== null && phase !== "drop" && <span className="arc-cap held" style={{ "--h": caps[got].hue } as React.CSSProperties} />}
      </div>
      {caps.map((c, i) => (got === i && phase !== "drop" ? null : <span key={i} className="arc-cap" style={{ left: `${c.x}%`, "--h": c.hue } as React.CSSProperties} />))}
      {phase === "done" && <div className={`arc-flash ${got !== null ? "win" : "lose"}`}>{got !== null ? "GRABBED!" : "SO CLOSE!"}</div>}
    </div>
    <button className="cm-btn cm-play qm-btn" onPointerDown={(e) => { e.preventDefault(); drop(); }} onClick={(e) => { if (e.detail === 0) drop(); }} disabled={phase !== "aim"}>DROP</button>
    <p className="arc-hint">Drop when the claw is right above a capsule. One try.</p>
  </div>;
}

// ---------------------------------------------------------------- rules

const RULES: Record<"stacker" | "claw", { title: string; steps: React.ReactNode[] }> = {
  stacker: { title: "Stacker rules", steps: [
    <>A row of blocks slides across. Tap <b>STOP</b> (or the board, or Space) to drop it.</>,
    <>Only blocks resting on the row below stay. The rest fall off, so your row gets shorter.</>,
    <>Reach the <b>top row</b> to win. Each row moves faster.</>,
    <>Win or lose, every play gives <b>1 Pack Ticket</b>, up to {ARCADE.freePerDay} a day. Use it to open a free trial pack.</>,
  ] },
  claw: { title: "Claw rules", steps: [
    <>Insert <b>2 tUSD</b> to play.</>,
    <>The claw slides by itself. Tap <b>DROP</b> when it is right above a capsule. One try.</>,
    <>Win or lose, you get <b>1 Season Ticket</b>. It opens a {"White Flare"} pack: one real card, yours as an NFT.</>,
    <>Grab a capsule and your card has a <b>{ARCADE.winRare}%</b> chance to be rare. Miss and it is <b>{ARCADE.loseRare}%</b>.</>,
  ] },
};

function Rules({ game, onClose }: { game: "stacker" | "claw"; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", key); return () => removeEventListener("keydown", key);
  }, [onClose]);
  const r = RULES[game];
  return <div className="arc-sheet" role="dialog" aria-modal="true" aria-label={r.title} onClick={onClose}>
    <section className="qm-card gs-card" onClick={(e) => e.stopPropagation()}>
      <h2>{r.title}</h2>
      <ol>{r.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <button className="cm-btn cm-play qm-btn" autoFocus onClick={onClose}>GOT IT</button>
    </section>
  </div>;
}

// ---------------------------------------------------------------- the arcade floor

type Playing = null | "stacker" | "claw";
/** `retry` is set when the ticket could not be saved (wallet closed or failed): the play is not lost, it can be sent again. */
type Result = null | { game: "stacker" | "claw"; won: boolean; text: string; ok: boolean; retry?: boolean };

export default function Arcade() {
  const { call, accountId } = useWallet();
  const { t, season, refetch } = useTickets();
  const [playing, setPlaying] = useState<Playing>(null), [result, setResult] = useState<Result>(null);
  const [busy, setBusy] = useState(""), [err, setErr] = useState(""), [note, setNote] = useState(""), [rules, setRules] = useState<null | "stacker" | "claw">(null);

  /**
   * Send one transaction, then let the chain decide: `done(before, now)` says whether it landed. Some wallets (Meteor)
   * report "closed the window" or never answer even after sending, so a reply alone is never trusted.
   * "cancel" = the player closed the wallet and nothing landed.
   */
  async function tx(label: string, c: Parameters<typeof call>[0], done: (before: TicketsJson, now: TicketsJson) => boolean): Promise<"ok" | "cancel" | "fail"> {
    if (!accountId) return "fail";
    setBusy(label); setErr("");
    try {
      const before = await fetchTickets(accountId);
      let m = "";
      try { const r = await call(c); if (r.failure) m = r.failure; } catch (e) { m = (e as Error)?.message ?? String(e); }
      if (/Smart contract panicked/.test(m)) { setErr(readable(m)); return "fail"; }
      if (await landed(async () => done(before, await fetchTickets(accountId)), m && isCancel(m) ? 6 : 14)) return "ok";
      if (m && isCancel(m)) return "cancel";
      setErr(readable(m || "It did not go through. Try again."));
      return "fail";
    } finally { setBusy(""); refetch(); }
  }

  /** Free play: the game first, then claim the Pack Ticket (if today's 3 are not used up). */
  async function stackerDone(won: boolean) {
    setPlaying(null);
    if (!accountId || !t || t.free_left <= 0) { setResult({ game: "stacker", won, ok: false, text: "That one was just for fun: today's 3 free tickets are used. Come back tomorrow." }); return; }
    await claimTicket(won);
  }
  async function claimTicket(won: boolean) {
    const r = await tx("Claiming your ticket…", { receiverId: A.game!, methodName: "arcade_free_play", args: {}, gas: TGAS(20) }, (b, n) => n.pack > b.pack);
    setResult({ game: "stacker", won, ok: r === "ok", retry: r !== "ok",
      text: r === "ok" ? "+1 Pack Ticket. Open a free trial pack with it." : r === "cancel" ? "You closed the wallet before claiming. Your ticket is still waiting: claim it now." : "Your ticket could not be claimed. Try again." });
  }

  /** Paid play: insert 2 tUSD first, then play. A paid play survives a reload (it waits as claw_pending). */
  async function insertCoin() {
    const r = await tx("Inserting 2 tUSD…", { receiverId: A.tusd!, methodName: "ft_transfer_call", args: { receiver_id: A.game, amount: ARCADE.clawPrice, msg: JSON.stringify({ action: "arcade_claw" }) }, deposit: ONE_YOCTO, gas: TGAS(60) }, (b, n) => n.claw_pending > b.claw_pending);
    if (r === "ok") setPlaying("claw");
    else if (r === "cancel") setNote("You closed the wallet, so nothing was charged.");
  }
  async function clawDone(won: boolean) {
    setPlaying(null);
    await saveClaw(won);
  }
  /** The result is kept on screen until it is saved, so closing the wallet never throws away a grab. */
  async function saveClaw(won: boolean) {
    const r = await tx("Saving your result…", { receiverId: A.game!, methodName: "arcade_claw_result", args: { won }, gas: TGAS(20) }, (b, n) => n.season_win + n.season_lose > b.season_win + b.season_lose);
    setResult({ game: "claw", won, ok: r === "ok", retry: r !== "ok",
      text: r === "ok" ? `+1 Season Ticket. ${won ? "Nice grab: better odds of a rare card." : "Open it for your White Flare card."}` : r === "cancel" ? "You closed the wallet before saving. Your result is kept: save it to get your Season Ticket." : "Your result could not be saved yet. Try again." });
  }

  if (playing) return <GameScreen title={playing === "stacker" ? "STACKER" : "CLAW"} tabs={ARCADE_TABS}>
    <section className="qm-card gs-card arc-play">{playing === "stacker" ? <Stacker onDone={stackerDone} /> : <Claw onDone={clawDone} />}</section>
  </GameScreen>;

  const pending = t?.claw_pending ?? 0;
  return <GameScreen title="ARCADE" tabs={ARCADE_TABS}>
    <div className="arc-wallet" aria-label="Your tickets">
      <span><Ticket size={16} /><b>{t?.pack ?? 0}</b> Pack</span>
      <span className="season"><Sparkles size={16} /><b>{season}</b> Season</span>
      <span className="free"><b>{t?.free_left ?? ARCADE.freePerDay}</b>/{ARCADE.freePerDay} free today</span>
    </div>

    {result && <section className={`qm-card gs-card arc-result ${result.won ? "win" : ""}`} role="status">
      <h2>{result.game === "stacker" ? (result.won ? "You reached the top!" : "Good try!") : result.won ? "You grabbed one!" : "Missed, but…"}</h2>
      <p>{result.text}</p>
      <div className="arc-actions">
        {result.ok && <Link className="cm-btn cm-play qm-btn" href={result.game === "claw" ? "/packs?tab=season" : "/packs"}>{result.game === "claw" ? "OPEN WHITE FLARE" : "OPEN A PACK"}</Link>}
        {result.retry && <button className="cm-btn cm-play qm-btn" disabled={!!busy} onClick={() => (result.game === "claw" ? saveClaw(result.won) : claimTicket(result.won))}>{result.game === "claw" ? "SAVE RESULT" : "CLAIM TICKET"}</button>}
        <button className="cm-btn cm-collection qm-btn" onClick={() => setResult(null)}>BACK TO ARCADE</button>
      </div>
    </section>}

    {!result && <div className="arc-floor">
      <section className="qm-card gs-card arc-machine stacker">
        <span className="arc-tag free">FREE PLAY</span>
        <div className="arc-art" aria-hidden><i /><i /><i /><i /><i /></div>
        <h2>Stacker</h2>
        <p>Stack the blocks to the top. Every play wins a <b>Pack Ticket</b>.</p>
        <button className="arc-rules-btn" onClick={() => setRules("stacker")}><BookOpen size={15} />Rules</button>
        <button className="cm-btn cm-packs qm-btn" disabled={!!busy} onClick={() => { setErr(""); setPlaying("stacker"); }}>{t && t.free_left <= 0 ? "PLAY FOR FUN" : "PLAY FREE"}</button>
      </section>
      <section className="qm-card gs-card arc-machine claw">
        <span className="arc-tag paid">2 tUSD</span>
        <div className="arc-art" aria-hidden><b /><i /><i /><i /></div>
        <h2>Claw</h2>
        <p>Grab a capsule. Every play wins a <b>Season Ticket</b>.</p>
        <button className="arc-rules-btn" onClick={() => setRules("claw")}><BookOpen size={15} />Rules</button>
        <button className="cm-btn cm-ranked qm-btn" disabled={!!busy || !accountId} onClick={() => { setNote(""); pending > 0 ? setPlaying("claw") : insertCoin(); }}>{pending > 0 ? `PLAY (${pending} PAID)` : "INSERT 2 tUSD"}</button>
      </section>
    </div>}

    {busy && <p className="arc-busy" role="status"><Gamepad2 size={16} />{busy}</p>}
    {note && !busy && <p className="arc-busy" role="status">{note}</p>}
    {err && <p className="arc-err" role="alert">{err} {/tUSD|balance|enough/i.test(err) && <Link href="/deposit">Get free coins</Link>}</p>}
    {rules && <Rules game={rules} onClose={() => setRules(null)} />}
  </GameScreen>;
}
