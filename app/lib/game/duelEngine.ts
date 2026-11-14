// A line-by-line port of near/game/src/duel.rs, so practice plays by exactly the same rules as an online duel.
// Pure: no React, no browser APIs. `Roll` supplies randomness (the contract uses a keccak seed, practice uses Math.random).
import cardsJson from "../../../shared/cards.json";
import type { DuelCard, DuelJson, DuelLog, DuelSide, Move } from "./duel";

type CardData = { id: number; tier: number; assetClass: string; hp: number; atk: number; def: number; spd: number };
const DATA = (cardsJson as { cards: CardData[] }).cards;
const stats = (id: number) => DATA[id];

export const WIN_POINTS = 3, MAX_ENERGY = 5, POWER_COST = 3, RETREAT_COST = 1;
const ENERGY_BPS = 1500, POWER_PCT = 160, ADVANTAGE_PCT = 125, DISADVANTAGE_PCT = 80, SHIELD_RECHARGE = 3;

const [PEGSHELL, SENTINEL, TORTOISE, OWL, GOLEM, SPRITE, CRAB, BISON, LYNX, HERON, RAM, FOX, BEAR, BEETLE, KESTREL, SERPENT, RAPTOR, WOLF, WASP, KRAKEN, PANTHER, COMET, MANTIS, HYDRA] =
  Array.from({ length: 24 }, (_, i) => i);

export type Roll = (n: number) => number;
export const randomRoll: Roll = (n) => Math.floor(Math.random() * n);

/** One deck going into a duel: 8 creature ids in play order, a picture per slot, a perk (% max HP) per slot, and the risk tier. */
export type Setup = { lineup: number[]; art: number[]; perk: number[]; tier: number };

export const starterLineup = (tier: number) => Array.from({ length: 8 }, (_, i) => (tier % 3) * 8 + i);
export const starterSetup = (tier: number): Setup => ({ lineup: starterLineup(tier), art: Array(8).fill(0), perk: Array(8).fill(0), tier: tier % 3 });

const crit = (tier: number): [number, number] => (tier === 0 ? [500, 130] : tier === 1 ? [1200, 150] : [2500, 180]);
const CLASSES = ["Stable", "Treasury", "Gold", "Credit", "BTC"];
const classIndex = (id: number) => Math.max(0, CLASSES.indexOf(stats(id).assetClass));
export function classPct(attacker: number, defender: number): number {
  const a = classIndex(attacker), d = classIndex(defender);
  return (a + 1) % 5 === d ? ADVANTAGE_PCT : (d + 1) % 5 === a ? DISADVANTAGE_PCT : 100;
}

export function card(id: number, perk = 0): DuelCard {
  const maxHp = Math.floor((stats(id).hp * 50 * (100 + perk)) / 100);
  return { id, hp: maxHp, max_hp: maxHp, energy: 0, atk_bonus: 0, crit_bonus: 0, widen: 0, halved: false, used: false, shield_cd: 0 };
}
const perkOf = (s: DuelSide, id: number) => { const i = s.lineup.indexOf(id); return i >= 0 ? s.perk?.[i] ?? 0 : 0; };

function makeSide(s: Setup): DuelSide {
  const l = s.lineup;
  return { active: card(l[0], s.perk[0]), bench: [1, 2, 3].map((i) => card(l[i], s.perk[i])), hand: l.slice(4), points: 0, faints: 0, turns: 0, lineup: [...l], art: [...s.art], perk: [...s.perk], tier: s.tier } as DuelSide;
}

const spd = (c: DuelCard) => stats(c.id).spd;
const baseDamage = (atk: number, def: number) => Math.floor((atk * 1000) / (50 + def));

function heal(c: DuelCard, amount: number): number {
  if (c.hp === 0) return 0;
  if (c.halved) { c.halved = false; amount = Math.floor(amount / 2); }
  const before = c.hp;
  c.hp = Math.min(c.hp + amount, c.max_hp);
  return c.hp - before;
}

/** Ape Comet always goes first, otherwise the higher SPD (Basis Kestrel borrows the enemy's if higher); ties roll. */
function initiative(sides: DuelSide[], roll: Roll): number {
  const eff = (me: number) => {
    const mine = sides[me].active, theirs = sides[1 - me].active;
    const own = spd(mine);
    const s = mine.id === KESTREL ? Math.max(own, spd(theirs)) : own;
    return mine.id === COMET ? Infinity : s;
  };
  const a = eff(0), b = eff(1);
  return a > b ? 0 : b > a ? 1 : roll(2);
}

function beginTurn(d: DuelJson) {
  const s = d.sides[d.mover];
  s.turns = Math.min(255, s.turns + 1);
  s.active.shield_cd = Math.max(0, s.active.shield_cd - 1);
  s.bench.forEach((b) => { b.shield_cd = Math.max(0, b.shield_cd - 1); });
}

export function newDuel(a: Setup, b: Setup, roll: Roll = randomRoll): DuelJson {
  const sides = [makeSide(a), makeSide(b)] as [DuelSide, DuelSide];
  const d: DuelJson = { sides, mover: initiative(sides, roll), turn: 1, energy_used: false, retreated: false, winner: null, last_move_at: Math.floor(Date.now() / 1000), log: [] };
  beginTurn(d);
  return d;
}

type Hit = { damage: number; selfDamage: number; crit: boolean; dodged: boolean };

function strike(d: DuelJson, me: number, strong: boolean, roll: Roll): Hit {
  const foe = 1 - me;
  const h: Hit = { damage: 0, selfDamage: 0, crit: false, dodged: false };
  const a = { ...d.sides[me].active };
  const t = { ...d.sides[foe].active };
  const atk = stats(a.id).atk, ddef = stats(t.id).def;

  const lynx = a.id === LYNX && d.sides[me].turns === 1;
  const atkEff = Math.floor(((atk + a.atk_bonus) * (10000 + (lynx ? 1000 : 0))) / 10000);
  let defMod = 10000;
  if (t.id === GOLEM) defMod += 1000 * Math.min(3, d.sides[foe].faints);
  if (t.id === BEAR && t.hp * 2 < t.max_hp) defMod += 1500;
  if (t.widen > 0) defMod -= 1000;
  let defEff = Math.floor((ddef * defMod) / 10000);
  if (a.id === RAM && !a.used) { d.sides[me].active.used = true; defEff = Math.floor(defEff / 2); }

  let dmg = baseDamage(atkEff, defEff);
  dmg = Math.floor((dmg * (10000 + ENERGY_BPS * a.energy)) / 10000);
  if (strong) dmg = Math.floor((dmg * POWER_PCT) / 100);
  dmg = Math.floor((dmg * classPct(a.id, t.id)) / 100);
  dmg = Math.floor((dmg * (90 + roll(21))) / 100);

  const [critBps, critMul] = crit(d.sides[me].tier);
  // The crit roll is always consumed, even when Audit cancels it.
  if (roll(10000) < critBps + a.crit_bonus) {
    const foeActive = d.sides[foe].active;
    if (foeActive.id === OWL && !foeActive.used) foeActive.used = true;
    else { h.crit = true; dmg = Math.floor((dmg * critMul) / 100); }
  }

  if (a.id === KRAKEN) dmg = Math.floor((dmg * 60) / 100);
  if (a.id === RAPTOR) {
    if (roll(100) < 60) dmg *= 2;
    else { dmg = Math.floor(dmg / 2); h.selfDamage = Math.floor(a.max_hp / 10); }
  }

  if (t.id === MANTIS && roll(100) < 20) { h.dodged = true; return h; }
  const live = d.sides[foe].active;
  if (live.id === PEGSHELL && live.shield_cd === 0) { live.shield_cd = SHIELD_RECHARGE; return h; }
  if (t.id === TORTOISE) dmg = Math.floor((dmg * 90) / 100);
  if (dmg === 0) dmg = 1;
  h.damage = dmg;
  return h;
}

function knockOut(d: DuelJson, side: number) {
  const other = 1 - side;
  d.sides[other].points += 1;
  d.sides[side].faints += 1;
  const s = d.sides[side];
  const noCardsLeft = s.bench.length === 0 && s.hand.length === 0;
  if (!noCardsLeft) {
    if (s.bench.length) s.active = s.bench.shift()!;
    else { const id = s.hand.shift()!; s.active = card(id, perkOf(s, id)); }
    if (s.hand.length) { const next = s.hand.shift()!; s.bench.push(card(next, perkOf(s, next))); }
  }
  const pa = d.sides[0].points >= WIN_POINTS, pb = d.sides[1].points >= WIN_POINTS;
  d.winner = pa && pb ? 2 : pa ? 0 : pb ? 1 : noCardsLeft ? other : d.winner;
}

/** Land the hit: damage, after-hit abilities, knockouts. Returns true if the defender's card was knocked out. */
function apply(d: DuelJson, me: number, h: Hit): boolean {
  const foe = 1 - me;
  const a = d.sides[me].active, t = d.sides[foe].active;
  if (h.damage > 0) {
    if (h.damage >= t.hp) {
      if (t.id === BISON && !t.used) { t.used = true; t.hp = 1; } else t.hp = 0;
    } else t.hp -= h.damage;
    if (a.id === WOLF && t.hp * 5 < t.max_hp) t.hp = 0;
    if (t.id === CRAB) a.hp = Math.max(0, a.hp - Math.floor(h.damage / 10));
    if (a.id === WASP && a.hp > 0) heal(a, Math.floor((h.damage * 30) / 100));
    if (a.id === SERPENT) t.widen = 2;
    if (a.id === HYDRA) t.halved = true;
  }
  if (h.selfDamage > 0) a.hp = Math.max(0, a.hp - h.selfDamage);
  let ko = false;
  if (d.sides[foe].active.hp === 0) { ko = true; knockOut(d, foe); }
  if (d.winner === null && d.sides[me].active.hp === 0) knockOut(d, me);
  return ko;
}

function endTurn(d: DuelJson) {
  const me = d.mover;
  const s = d.sides[me];
  const a = s.active;
  if (a.id === SENTINEL) heal(a, Math.floor(a.max_hp / 20));
  else if (a.id === BEETLE) heal(a, Math.floor((a.max_hp * 3) / 100));
  if (a.id === HERON && a.atk_bonus < 10) a.atk_bonus += 2;
  if (a.id === PANTHER && a.crit_bonus < 2500) a.crit_bonus += 500;
  // Redeem (below 30% HP) and Rebalance (below 40% HP): once per match, swap with the first bench card, free.
  const threshold: [number, number] | null = a.id === SPRITE ? [3, 10] : a.id === FOX ? [2, 5] : null;
  if (threshold && !a.used && a.hp * threshold[1] < a.max_hp * threshold[0] && s.bench.length) {
    s.active.used = true;
    const out = s.active; s.active = s.bench[0]; s.bench[0] = out;
  }
  const foe = d.sides[1 - me];
  foe.active.widen = Math.max(0, foe.active.widen - 1);
  foe.bench.forEach((b) => { b.widen = Math.max(0, b.widen - 1); });
  d.mover = 1 - d.mover; d.turn += 1; d.energy_used = false; d.retreated = false;
  beginTurn(d);
}

export type Refusal = "duel finished" | "energy already attached this turn" | "already retreated this turn" | "no card in that bench slot" | "not enough energy to attack" | "retreat costs 1 energy";

const push = (d: DuelJson, action: number, arg: number, card_: number, target: number, damage: number, crit_: boolean, dodged: boolean, ko: boolean) => {
  d.log.push({ side: d.mover, action, arg, card: card_, target, damage, crit: crit_, dodged, ko } as DuelLog);
};

/** Apply one move by the current mover to a COPY of the duel. Returns the new duel, or a refusal. */
export function play(duel: DuelJson, move: Move, roll: Roll = randomRoll): { duel: DuelJson } | { refused: Refusal } {
  const d = structuredClone(duel);
  if (d.winner !== null) return { refused: "duel finished" };
  const me = d.mover;
  const [action, arg] = move;
  if (action === 0) {
    if (d.energy_used) return { refused: "energy already attached this turn" };
    const a = d.sides[me].active;
    a.energy = Math.min(MAX_ENERGY, a.energy + 1);
    d.energy_used = true;
    push(d, 0, 0, a.id, a.id, 0, false, false, false);
  } else if (action === 3) {
    if (d.retreated) return { refused: "already retreated this turn" };
    const s = d.sides[me];
    if (arg >= s.bench.length) return { refused: "no card in that bench slot" };
    if (s.active.energy < RETREAT_COST) return { refused: "retreat costs 1 energy" };
    s.active.energy -= RETREAT_COST;
    const out = s.active; s.active = s.bench[arg]; s.bench[arg] = out;
    d.retreated = true;
    push(d, 3, arg, s.active.id, out.id, 0, false, false, false);
  } else {
    const strong = action === 2;
    if (d.sides[me].active.energy < (strong ? POWER_COST : 1)) return { refused: "not enough energy to attack" };
    const hits = d.sides[me].active.id === KRAKEN ? 2 : 1;
    const attacker = d.sides[me].active.id;
    let total = 0, critAny = false, dodged = false, ko = false;
    let target = d.sides[1 - me].active.id;
    for (let i = 0; i < hits; i++) {
      // Recursive Loop: each hit picks its target again, and stops if the Kraken is gone.
      if (d.winner !== null || d.sides[me].active.id !== attacker || d.sides[me].active.hp === 0) break;
      target = d.sides[1 - me].active.id;
      const h = strike(d, me, strong, roll);
      total += h.damage; critAny = critAny || h.crit; dodged = dodged || h.dodged;
      ko = apply(d, me, h) || ko;
    }
    push(d, strong ? 2 : 1, 0, attacker, target, total, critAny, dodged, ko);
    if (d.winner === null) endTurn(d);
  }
  d.last_move_at = Math.floor(Date.now() / 1000);
  return { duel: d };
}

/** The other side wins because `loser` forfeited. */
export function concede(duel: DuelJson, loser: number): DuelJson {
  const d = structuredClone(duel);
  if (d.winner === null) d.winner = 1 - (loser % 2);
  return d;
}

/**
 * The computer's whole turn as a list of moves: retreat a badly hurt card, attach Energy, then attack, using a power
 * attack as soon as it has the Energy. Deliberately simple, so practice is a fair test and not a strong opponent.
 */
export function computerTurn(d: DuelJson, side: number): Move[] {
  const s = d.sides[side];
  const moves: Move[] = [];
  let active = s.active;
  if (!d.retreated && active.energy >= RETREAT_COST && active.hp / active.max_hp < 0.3) {
    let best = -1, ratio = 0.5;
    s.bench.forEach((b, i) => { const r = b.hp / b.max_hp; if (r > ratio) { ratio = r; best = i; } });
    if (best >= 0) { moves.push([3, best]); active = { ...s.bench[best] }; }
  }
  let energy = active.energy;
  if (!d.energy_used && energy < MAX_ENERGY) { moves.push([0, 0]); energy += 1; }
  moves.push([energy >= POWER_COST ? 2 : 1, 0]);
  return moves;
}
