import { catalog } from "./catalog";
import { defaultArt, fresh, skinOf, type DuelCard, type DuelJson, type DuelSide } from "./duel";
import type { BattleState, Fighter } from "./simulation";

/** The picture a side shows for one of its creatures: its chosen art, or the creature's own deck art. */
export const imgFor = (s: DuelSide, id: number) => { const a = skinOf(s, id); return a > 0 && catalog.some((c) => c.id === a) ? a : defaultArt(id); };
export const fighter = (s: DuelSide, c: DuelCard): Fighter => ({ id: imgFor(s, c.id), hp: c.hp, maxHp: c.max_hp, energy: c.energy });

/** The onchain duel in the shape the practice board draws: "player" is you, "opponent" is the other account. */
export function toBoard(d: DuelJson, me: number, mine: DuelSide): BattleState {
  const side = (s: DuelSide) => ({ active: fighter(s, s.active), bench: s.bench.map((c) => fighter(s, c)), hand: s.hand.map((id) => imgFor(s, id)), points: s.points });
  return {
    player: side(mine), opponent: side(d.sides[1 - me]), turn: Math.ceil(d.turn / 2), energyUsed: d.energy_used,
    winner: d.winner === me ? "player" : d.winner === 1 - me ? "opponent" : null,
  };
}

/**
 * The board after each move of a finished (or running) duel, rebuilt from the contract's move log: frame 0 is the
 * start, frame i+1 is after log entry i. Who is active, the bench, the hand, points and Energy follow the log exactly.
 * The log records damage dealt but not HP afterwards, so HP is approximate for cards that heal or reflect damage.
 */
export function buildFrames(d: DuelJson): DuelJson[] {
  const start = (s: DuelSide): DuelSide => ({ active: fresh(s.lineup[0]), bench: s.lineup.slice(1, 4).map(fresh), hand: s.lineup.slice(4), points: 0, faints: 0, turns: 0, lineup: s.lineup, art: s.art, tier: s.tier });
  const sides: [DuelSide, DuelSide] = [start(d.sides[0]), start(d.sides[1])];
  let mover = d.log.length ? d.log[0].side : d.mover;
  let turn = 1;
  const frame = (i: number): DuelJson => ({ ...d, sides: structuredClone(sides) as [DuelSide, DuelSide], mover, turn, energy_used: false, retreated: false, winner: i === d.log.length ? d.winner : null, log: d.log.slice(0, i) });
  const out = [frame(0)];
  d.log.forEach((e, i) => {
    const me = sides[e.side], foe = sides[1 - e.side];
    if (e.action === 0) {
      me.active.energy = Math.min(5, me.active.energy + 1);
    } else if (e.action === 3) {
      me.active.energy = Math.max(0, me.active.energy - 1); // the retreating card pays the retreat cost
      const out_ = me.active; me.active = me.bench[e.arg] ?? out_; if (me.bench[e.arg]) me.bench[e.arg] = out_;
    } else {
      if (!e.dodged && e.damage > 0) foe.active.hp = Math.max(e.ko ? 0 : 1, foe.active.hp - e.damage);
      if (e.ko) {
        foe.active.hp = 0; me.points += 1; foe.faints += 1;
        const none = foe.bench.length === 0 && foe.hand.length === 0;
        if (!none) {
          foe.active = foe.bench.length ? foe.bench.shift()! : fresh(foe.hand.shift()!);
          if (foe.hand.length) foe.bench.push(fresh(foe.hand.shift()!));
        }
      }
      mover = 1 - e.side; turn += 1;
    }
    if (i === d.log.length - 1) { sides[0].points = d.sides[0].points; sides[1].points = d.sides[1].points; } // the last frame shows the real score
    out.push(frame(i + 1));
  });
  return out;
}
