import { cards } from "@/lib/contracts";
import { decks } from "./catalog";

/** Mirrors near/game/src/duel.rs (the contract's own JSON for `get_duel`). */
export type DuelCard = { id: number; hp: number; max_hp: number; energy: number; atk_bonus: number; crit_bonus: number; widen: number; halved: boolean; used: boolean; shield_cd: number };
export type DuelSide = { active: DuelCard; bench: DuelCard[]; hand: number[]; points: number; faints: number; turns: number; lineup: number[]; art: number[]; tier: number };
export type DuelLog = { side: number; action: number; arg: number; card: number; target: number; damage: number; crit: boolean; dodged: boolean; ko: boolean };
export type DuelJson = {
  sides: [DuelSide, DuelSide];
  mover: number;
  turn: number;
  energy_used: boolean;
  retreated: boolean;
  /** 0 or 1 for the winning side, 2 for a draw. */
  winner: number | null;
  last_move_at: number;
  log: DuelLog[];
};
/** Action codes the contract understands: 0 attach, 1 attack, 2 power attack, 3 retreat (arg = bench slot). */
export type Move = [action: number, arg: number];
export const ATTACH: Move = [0, 0];
export const ATTACK: Move = [1, 0];
export const POWER: Move = [2, 0];
export const retreat = (slot: number): Move => [3, slot];
export const TURN_SECS = 300;
export const MAX_ENERGY = 5;
export const POWER_COST = 3;
export const RETREAT_COST = 1;

/** A deck as the contract stores it: 8 creature ids in play order and an art skin for each (0 = default face). */
export type DeckCardsJson = { cards: number[]; art: number[]; custom: boolean };
export const ART_MAX = 102;
/**
 * The picture a creature shows when no art is chosen (art 0): the card from its own deck's art. The starter deck of
 * each tier shows exactly the cards on the deck carousel, so what you pick in the deposit screen is what you see here.
 */
export const defaultArt = (id: number) => decks[Math.floor(id / 8) % 3].cards[id % 8];
/** The starter lineup of a tier: creatures tier*8 .. tier*8+7 in order. */
export const starterCards = (tier: number) => Array.from({ length: 8 }, (_, i) => tier * 8 + i);
export const SLOT_ROLES = ["Leader", "Bench", "Bench", "Bench", "Hand", "Hand", "Hand", "Hand"];
/** The art skin a side chose for one of its creatures. */
export const skinOf = (side: DuelSide, id: number) => side.art[side.lineup.indexOf(id)] ?? 0;
/** A full-health, no-energy card, for showing a creature outside a match. */
export const fresh = (id: number): DuelCard => ({ id, hp: creature(id).hp * 50, max_hp: creature(id).hp * 50, energy: 0, atk_bonus: 0, crit_bonus: 0, widen: 0, halved: false, used: false, shield_cd: 0 });

const CLASSES = ["Stable", "Treasury", "Gold", "Credit", "BTC"];
export const creature = (id: number) => cards[id];
const classIndex = (id: number) => Math.max(0, CLASSES.indexOf(creature(id).assetClass));

/** Class wheel: each class is strong against the next (Stable > Treasury > Gold > Credit > BTC > Stable). */
export function classPct(attacker: number, defender: number): number {
  const a = classIndex(attacker), d = classIndex(defender);
  return (a + 1) % 5 === d ? 125 : (d + 1) % 5 === a ? 80 : 100;
}
export const hasEdge = (attacker: number, defender: number) => classPct(attacker, defender) > 100;
export const hasDisadvantage = (attacker: number, defender: number) => classPct(attacker, defender) < 100;

/** Rough damage of one attack before variance, crit and abilities. Same maths as `preview` in duel.rs. */
export function estimate(attacker: DuelCard, defender: DuelCard, strong: boolean): number {
  const a = creature(attacker.id), d = creature(defender.id);
  let dmg = Math.floor(((a.atk + attacker.atk_bonus) * 1000) / (50 + d.def));
  dmg = Math.floor((dmg * (10000 + 1500 * attacker.energy)) / 10000);
  if (strong) dmg = Math.floor((dmg * 160) / 100);
  return Math.floor((dmg * classPct(attacker.id, defender.id)) / 100);
}

/** What your side looks like after the moves you have lined up but not sent yet (attach and retreat). */
export function stage(side: DuelSide, moves: Move[]): DuelSide {
  const s: DuelSide = { ...side, active: { ...side.active }, bench: side.bench.map((b) => ({ ...b })) };
  for (const [action, arg] of moves) {
    if (action === 0) s.active.energy = Math.min(MAX_ENERGY, s.active.energy + 1);
    else if (action === 3 && s.bench[arg]) {
      s.active.energy = Math.max(0, s.active.energy - RETREAT_COST);
      const out = s.active; s.active = s.bench[arg]; s.bench[arg] = out;
    }
  }
  return s;
}

/** One recorded move as a sentence. */
export function describe(e: DuelLog, who: string): string {
  const me = creature(e.card).name;
  if (e.action === 0) return `${who} attached an Energy to ${me}.`;
  if (e.action === 3) return `${who} retreated ${creature(e.target).name} and sent in ${me}.`;
  const hit = e.dodged ? "missed (dodged)" : e.damage === 0 ? "was blocked" : `hit ${creature(e.target).name} for ${e.damage}${e.crit ? " (crit!)" : ""}`;
  return `${who}'s ${me} ${e.action === 2 ? "power attacked and " : ""}${hit}${e.ko ? ", a knockout!" : "."}`;
}
