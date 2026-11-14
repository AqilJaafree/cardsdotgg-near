// Tests for the TypeScript duel engine (lib/game/duelEngine.ts). These mirror the unit tests in near/game/src/duel.rs,
// so practice and the contract are held to the same rules. Run: pnpm test:duel
import assert from "node:assert/strict";
import { test } from "node:test";
import { card, classPct, computerTurn, concede, newDuel, play, starterSetup, type Setup } from "../lib/game/duelEngine";
import type { DuelJson, Move } from "../lib/game/duel";

const ATTACH: Move = [0, 0], ATTACK: Move = [1, 0], POWER: Move = [2, 0];
// A fixed roll: no crit (the crit roll is high), middling variance, Raptor does not miss, Mantis never dodges.
const noCrit = (n: number) => (n === 10000 ? 9999 : n === 21 ? 10 : n === 100 ? 99 : 0);
const ok = (r: ReturnType<typeof play>) => { if ("refused" in r) throw new Error(r.refused); return r.duel; };
const fresh = (a = 0, b = 2): DuelJson => newDuel(starterSetup(a), starterSetup(b), () => 0);
const setMover = (d: DuelJson, m: number): DuelJson => ({ ...d, mover: m });

test("starts from the starter lineups, and SPD decides who goes first", () => {
  const d = fresh();
  assert.equal(d.sides[0].active.id, 0);
  assert.equal(d.sides[0].active.max_hp, 37 * 50);
  assert.deepEqual(d.sides[0].bench.map((c) => c.id), [1, 2, 3]);
  assert.deepEqual(d.sides[0].hand, [4, 5, 6, 7]);
  assert.equal(d.sides[1].active.id, 16);
  assert.equal(d.mover, 1);          // Leverage Raptor (29) is faster than Pegshell (17)
  assert.equal(d.sides[1].turns, 1);
  const comet = starterSetup(2); comet.lineup = [21, 17, 18, 19, 20, 16, 22, 23];
  assert.equal(newDuel(starterSetup(0), comet, () => 1).mover, 1); // Ape Comet always leads
});

test("energy and retreat once per turn, an attack ends the turn", () => {
  let d = setMover(fresh(), 0);
  assert.equal((play(d, ATTACK) as { refused: string }).refused, "not enough energy to attack");
  assert.equal((play(d, [3, 0]) as { refused: string }).refused, "retreat costs 1 energy");
  d = ok(play(d, ATTACH));
  assert.equal(d.sides[0].active.energy, 1);
  assert.equal((play(d, ATTACH) as { refused: string }).refused, "energy already attached this turn");
  d = ok(play(d, [3, 0]));
  assert.equal(d.sides[0].active.id, 1);
  assert.equal(d.sides[0].bench[0].energy, 0);
  assert.equal((play(d, [3, 1]) as { refused: string }).refused, "already retreated this turn");
  assert.equal((play(d, ATTACK) as { refused: string }).refused, "not enough energy to attack");
});

test("an attack deals damage, ends the turn and resets the per-turn flags", () => {
  let d = setMover(fresh(), 0);
  d.sides[0].active.energy = 2;
  const hp = d.sides[1].active.hp;
  d = ok(play(d, ATTACK, noCrit));
  assert.ok(d.sides[1].active.hp < hp);
  assert.equal(d.log[0].damage, hp - d.sides[1].active.hp);
  assert.equal(d.mover, 1); assert.equal(d.turn, 2);
  assert.ok(!d.energy_used && !d.retreated);
  assert.equal(d.sides[1].turns, 2);
});

test("power needs three Energy; Energy caps at five; the class wheel", () => {
  const d = setMover(fresh(), 0);
  d.sides[0].active.energy = 2;
  assert.equal((play(d, POWER) as { refused: string }).refused, "not enough energy to attack");
  d.sides[0].active.energy = 5;
  assert.equal(ok(play(d, ATTACH)).sides[0].active.energy, 5);
  assert.equal(classPct(0, 1), 125); assert.equal(classPct(1, 0), 80); assert.equal(classPct(0, 0), 100); assert.equal(classPct(0, 8), 100);
});

test("a knockout scores, promotes the bench and refills it from the hand", () => {
  let d = setMover(fresh(), 0);
  d.sides[0].active.energy = 5; d.sides[1].active.hp = 1;
  d = ok(play(d, ATTACK, noCrit));
  assert.ok(d.log.at(-1)!.ko);
  assert.equal(d.sides[0].points, 1); assert.equal(d.sides[1].faints, 1);
  assert.equal(d.sides[1].active.id, 17);
  assert.deepEqual(d.sides[1].bench.map((c) => c.id), [18, 19, 20]);
  assert.deepEqual(d.sides[1].hand, [21, 22, 23]);
});

test("three knockouts win and freeze the duel; running out of cards also wins", () => {
  let d = setMover(fresh(), 0);
  for (let i = 0; i < 3; i++) { d = setMover(d, 0); d.sides[0].active.energy = 5; d.sides[1].active.hp = 1; d.sides[1].active.used = false; d = ok(play(d, ATTACK, noCrit)); }
  assert.equal(d.winner, 0);
  assert.equal((play(d, ATTACK) as { refused: string }).refused, "duel finished");
  let e = setMover(fresh(), 0);
  e.sides[0].active.energy = 5; e.sides[1].bench = []; e.sides[1].hand = []; e.sides[1].active.hp = 1;
  assert.equal(ok(play(e, ATTACK, noCrit)).winner, 0);
});

test("abilities: Peg Shield, Backstop, Redeem", () => {
  let d = setMover(newDuel(starterSetup(0), starterSetup(2), () => 0), 1);
  d.sides[1].active.energy = 5;
  const hp = d.sides[0].active.hp;
  d = ok(play(d, ATTACK, noCrit));
  assert.equal(d.sides[0].active.hp, hp); assert.equal(d.log[0].damage, 0);   // Peg Shield blocks the first hit
  assert.equal(d.sides[0].active.shield_cd, 2);                                // recharged, then ticked once for its owner's turn
  let b = setMover(newDuel(starterSetup(0), starterSetup(2), () => 0), 1);
  b.sides[0].active = card(7); b.sides[0].active.hp = 5; b.sides[1].active.energy = 5;
  b = ok(play(b, ATTACK, noCrit));
  assert.equal(b.sides[0].active.id, 7); assert.equal(b.sides[0].active.hp, 1); assert.ok(b.sides[0].active.used); // Reserve Bison survives once
  let f = setMover(newDuel(starterSetup(0), starterSetup(2), () => 0), 0);
  f.sides[0].active = card(5); f.sides[0].active.hp = 10; f.sides[0].active.energy = 1;
  f = ok(play(f, ATTACK, noCrit));
  assert.notEqual(f.sides[0].active.id, 5); assert.equal(f.sides[0].bench[0].id, 5); assert.ok(f.sides[0].bench[0].used); // Mint Sprite swaps out below 30%
});

test("a perk adds max HP to the card it is on, including cards that come in later", () => {
  const setup: Setup = { lineup: [0, 1, 2, 3, 4, 5, 6, 7], art: Array(8).fill(0), perk: [5, 0, 0, 0, 0, 2, 0, 0], tier: 0 };
  let d = newDuel(setup, starterSetup(2), () => 0);
  assert.equal(d.sides[0].active.max_hp, Math.floor((37 * 50 * 105) / 100));
  assert.equal(d.sides[0].bench[0].max_hp, 35 * 50);
  d = setMover(d, 1);
  d.sides[0].bench = []; d.sides[0].hand = [5]; d.sides[0].active = card(2); d.sides[0].active.hp = 1; d.sides[1].active.energy = 5;
  d = ok(play(d, ATTACK, noCrit));
  assert.equal(d.sides[0].active.id, 5);
  assert.equal(d.sides[0].active.max_hp, Math.floor((25 * 50 * 102) / 100));
});

test("forfeit hands the win to the other side", () => {
  assert.equal(concede(fresh(), 1).winner, 0);
  assert.equal(concede(fresh(), 0).winner, 1);
  assert.equal(concede(concede(fresh(), 0), 1).winner, 1);
});

test("every deck matchup, played by the computer on both sides, reaches a result", () => {
  let total = 0;
  for (const [a, b] of [[0, 0], [0, 1], [0, 2], [1, 1], [1, 2], [2, 2]]) {
    for (let n = 0; n < 6; n++) {
      let d = newDuel(starterSetup(a), starterSetup(b));
      let moves = 0;
      while (d.winner === null && moves < 600) {
        for (const m of computerTurn(d, d.mover)) { const r = play(d, m); if ("refused" in r) throw new Error(`computer made an illegal move ${m}: ${r.refused}`); d = r.duel; if (d.winner !== null) break; }
        moves++;
      }
      assert.notEqual(d.winner, null, `tiers ${a}v${b} did not finish`);
      assert.ok(d.turn < 120, `tiers ${a}v${b} took ${d.turn} turns`);
      total++;
    }
  }
  assert.equal(total, 36);
});
