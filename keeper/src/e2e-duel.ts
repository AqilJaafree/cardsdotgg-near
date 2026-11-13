// End-to-end duel on NEAR testnet with two fresh players, every move signed by a session key (no wallet): claim, deposit,
// challenge, accept_duel, add a restricted key, play_turn until someone wins, then check the key is boxed in.
// Env: NEAR_OWNER_ID, NEAR_OWNER_KEY (the owner funds the players' gas). Never prints keys.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Account, KeyPair, PublicKey, actions } from "near-api-js";
import * as coreNs from "../../app/lib/session-core.ts";
// The app package is CommonJS to node, so the named exports may sit on `default`.
const core = ((coreNs as unknown as { default?: typeof coreNs }).default ?? coreNs) as typeof coreNs;
const { SESSION_ALLOWANCE, SESSION_METHODS, callWithKey, keyIsLive, keyProblem, newSessionKey } = core;

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const T = (n: number) => BigInt(n) * 10n ** 12n;
const owner = new Account(ownerId, rpc, ownerKey);
// The owner account holds the contract (most of its balance is locked as storage), so the deploy's funder pays for test players.
const keyFile = new URL("../.deploy-keys.json", import.meta.url);
const funderKey = existsSync(keyFile) ? (JSON.parse(readFileSync(keyFile, "utf8")) as Record<string, string>).funder : undefined;
const funder = funderKey ? new Account(addr.funder, rpc, funderKey as `ed25519:${string}`) : owner;
const view = async <X,>(contractId: string, method: string, args: object = {}) => (await owner.provider.callFunction({ contractId, method, args } as never)) as X;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (m: string) => console.log("ok  ", m);
const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAILED: " + m); };

type DuelJson = { mover: number; turn: number; energy_used: boolean; winner: number | null; sides: { active: { energy: number }; points: number }[]; log: unknown[] };

async function player(name: string) {
  const kp = KeyPair.fromRandom("ed25519");
  const id = Buffer.from(kp.getPublicKey().data).toString("hex");
  const bal = await funder.provider.viewAccount({ accountId: funder.accountId }).then((x) => BigInt(x.amount)).catch(() => 0n);
  await (bal > 3n * 10n ** 23n ? funder : owner).transfer({ receiverId: id, amount: 16n * 10n ** 22n }); // 0.16 NEAR: gas is reserved up front per call, so each player needs a little
  ok(`${name} funded ${id.slice(0, 8)}`);
  return new Account(id, rpc, kp.toString() as `ed25519:${string}`);
}

async function main() {
  const a = await player("A"), b = await player("B");
  for (const p of [a, b]) await p.callFunction({ contractId: addr.tusd, methodName: "claim", args: {}, gas: T(30) });
  const dep = (p: Account, tier: number, amount: string) => p.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.game, amount, msg: JSON.stringify({ action: "deposit", tier }) }, deposit: 1n, gas: T(70) });
  await dep(a, 0, "100000000"); await dep(b, 2, "100000000");
  const [da] = await view<{ id: string }[]>(addr.game, "decks_of", { account_id: a.accountId });
  const [db] = await view<{ id: string }[]>(addr.game, "decks_of", { account_id: b.accountId });
  ok(`decks minted: A #${da.id} (Guardian), B #${db.id} (Degen)`);

  // the session key goes on each player's account through their own key, like the wallet does for the app
  const sessions: Record<string, { privateKey: string; publicKey: string }> = {};
  for (const p of [a, b]) {
    const s = await newSessionKey();
    await p.signAndSendTransaction({ receiverId: p.accountId, actions: [actions.addFunctionCallAccessKey(PublicKey.from(s.publicKey), addr.game, SESSION_METHODS, BigInt(SESSION_ALLOWANCE))] });
    sessions[p.accountId] = s;
    assert(await keyIsLive([rpc], p.accountId, s.publicKey, addr.game), "session key should be live after AddKey");
  }
  ok("session keys added and verified live (play_turn, play, forfeit, claim_timeout on the game contract only)");

  const id = String(await a.callFunction<string>({ contractId: addr.game, methodName: "create_challenge", args: { deck_id: da.id, opponent: b.accountId }, gas: T(60) }));
  await b.callFunction({ contractId: addr.game, methodName: "accept_duel", args: { match_id: id, deck_id: db.id }, gas: T(60) });
  const players = { 0: a, 1: b } as Record<number, Account>;
  ok(`duel #${id} started`);
  // STOP_AFTER_START=<file>: save the two session keys and the match id for a browser test, then stop before any move.
  if (process.env.STOP_AFTER_START) {
    writeFileSync(process.env.STOP_AFTER_START, JSON.stringify({ matchId: id, players: [a, b].map((p) => ({ id: p.accountId, key: sessions[p.accountId].privateKey })) }), { mode: 0o600 });
    ok("saved keys for the browser test; stopping before any move");
    return;
  }

  let n = 0;
  for (; n < 120; n++) {
    const d = await view<DuelJson>(addr.game, "get_duel", { match_id: id });
    if (d.winner !== null) break;
    const p = players[d.mover], s = sessions[p.accountId];
    const energy = d.sides[d.mover].active.energy + (d.energy_used ? 0 : 1);
    const moves = [...(d.energy_used ? [] : [[0, 0]]), [energy >= 3 ? 2 : 1, 0]];
    const r = await callWithKey({ rpcUrl: rpc, accountId: p.accountId, privateKey: s.privateKey, contractId: addr.game, methodName: "play_turn", args: { match_id: id, moves } });
    assert(!r.failure, `play_turn failed on-chain: ${r.failure}`);
    if (n % 4 === 0) console.log(`     turn ${d.turn}: side ${d.mover} played ${JSON.stringify(moves)} (tx ${r.hash?.slice(0, 8)})`);
    await sleep(600);
  }
  const d = await view<DuelJson>(addr.game, "get_duel", { match_id: id });
  const m = await view<{ status: number; winner: string | null }>(addr.game, "get_match", { match_id: id });
  assert(d.winner !== null && m.status === 3, "duel should be finished and the match resolved");
  ok(`finished after ${n} session-signed turns: side ${d.winner} won ${d.sides[0].points}-${d.sides[1].points}, match status ${m.status}, winner ${m.winner?.slice(0, 8)}, ${d.log.length} moves recorded`);

  // the key is boxed in: it cannot call any other method, and cannot attach a deposit
  for (const [method, args] of [["create_challenge", { deck_id: da.id, opponent: null }], ["withdraw", { deck_id: da.id, exit_asset: 0, min_out: "0" }], ["set_deck_cards", { deck_id: da.id, cards: [0, 1, 2, 3, 4, 5, 6, 7], art: [0, 0, 0, 0, 0, 0, 0, 0] }]] as const) {
    let msg = "";
    try { const r = await callWithKey({ rpcUrl: rpc, accountId: a.accountId, privateKey: sessions[a.accountId].privateKey, contractId: addr.game, methodName: method, args }); msg = r.failure ?? "NO ERROR"; }
    catch (e) { msg = (e as Error).message; }
    assert(msg !== "NO ERROR" && keyProblem(msg), `${method} must be refused by the chain for a session key, got: ${msg.slice(0, 120)}`);
  }
  ok("session key refused create_challenge, withdraw and set_deck_cards (method not allowed)");

  // how much of the 1 NEAR gas allowance the whole match used
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_access_key", finality: "optimistic", account_id: a.accountId, public_key: sessions[a.accountId].publicKey } }) });
  const left = BigInt((await res.json()).result.permission.FunctionCall.allowance);
  ok(`A's allowance used by ${n / 2} of its turns: ${Number(BigInt(SESSION_ALLOWANCE) - left) / 1e24} NEAR of the 0.25 NEAR cap`);
  console.log("E2E DUEL PASSED");
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
