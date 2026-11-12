// End-to-end loop on NEAR testnet with two fresh players: claim, deposit, seed, challenge, accept, resolve, replay, withdraw.
// Env: NEAR_OWNER_ID, NEAR_OWNER_KEY (the owner seeds escrow and funds the players' gas). Never prints keys.
import { readFileSync } from "node:fs";
import { Account, KeyPair, actions } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const T = (n: number) => BigInt(n) * 10n ** 12n;
const owner = new Account(ownerId, rpc, ownerKey);
const view = async <X,>(contractId: string, method: string, args: object = {}) => (await owner.provider.callFunction({ contractId, method, args } as never)) as X;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ok = (m: string) => console.log("ok  ", m);

async function player(name: string) {
  const kp = KeyPair.fromRandom("ed25519");
  const id = Buffer.from(kp.getPublicKey().data).toString("hex");
  await owner.transfer({ receiverId: id, amount: 15n * 10n ** 23n });
  ok(`${name} funded ${id.slice(0, 8)}`);
  return new Account(id, rpc, kp.toString() as `ed25519:${string}`);
}
async function main() {
  const a = await player("A"), b = await player("B");
  for (const p of [a, b]) {
    await p.callFunction({ contractId: addr.tusd, methodName: "claim", args: {}, gas: T(30) });
    const bal = await view<string>(addr.tusd, "ft_balance_of", { account_id: p.accountId });
    ok(`${p.accountId.slice(0, 8)} claimed, tUSD balance ${Number(bal) / 1e6}`);
  }
  const dep = (p: Account, tier: number, amount: string) => p.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.game, amount, msg: JSON.stringify({ action: "deposit", tier }) }, deposit: 1n, gas: T(100) });
  await dep(a, 0, "100000000"); await dep(b, 2, "200000000");
  const [da] = await view<{ id: string }[]>(addr.game, "decks_of", { account_id: a.accountId });
  const [db] = await view<{ id: string }[]>(addr.game, "decks_of", { account_id: b.accountId });
  ok(`decks minted: A #${da.id} (Guardian), B #${db.id} (Degen)`);
  for (const d of [da, db]) await owner.callFunction({ contractId: addr.game, methodName: "seed_escrow", args: { deck_id: d.id, amount: "1000000" }, gas: T(30) });
  ok("escrow seeded 1 tUSD each");

  const created = await a.callFunction<string>({ contractId: addr.game, methodName: "create_challenge", args: { deck_id: da.id, opponent: b.accountId }, gas: T(60) });
  const id = String(created);
  await b.callFunction({ contractId: addr.game, methodName: "accept", args: { match_id: id, deck_id: db.id }, gas: T(60) });
  let m = await view<{ status: number; stake_a: string; stake_b: string; seed_block: string }>(addr.game, "get_match", { match_id: id });
  ok(`match #${id} accepted, staked ${Number(m.stake_a) / 1e6} / ${Number(m.stake_b) / 1e6} tUSD, seed block ${m.seed_block}`);
  if (process.env.AUTO_RESOLVE) {
    // The resolver (pnpm resolve:watch) should settle the match without any player transaction.
    const started = Date.now();
    for (;;) {
      m = await view(addr.game, "get_match", { match_id: id });
      if (m.status === 3) break;
      if (Date.now() - started > 90_000) throw new Error("the resolver did not resolve the match within 90 s");
      await sleep(2000);
    }
    ok(`auto-resolved by the keeper after ${Math.round((Date.now() - started) / 1000)} s, no player signature`);
  } else {
    for (;;) {
      const h = (await owner.provider.viewBlock({ finality: "final" })).header.height;
      if (BigInt(h) > BigInt(m.seed_block)) break;
      await sleep(1000);
    }
    await owner.callFunction({ contractId: addr.game, methodName: "resolve", args: { match_id: id }, gas: T(150) });
  }
  const done = await view<{ status: number; seed: string; winner: string | null; stake_a: string; stake_b: string }>(addr.game, "get_match", { match_id: id });
  const winner = done.winner === a.accountId ? "A (Guardian)" : done.winner === b.accountId ? "B (Degen)" : "draw";
  ok(`resolved: status ${done.status}, winner ${winner}`);
  const sim = await view<{ winner_side: number; rounds: number }>(addr.game, "simulate", { seed: done.seed, tier_a: 0, tier_b: 2 });
  const log = await view<unknown[]>(addr.game, "simulate_with_log", { seed: done.seed, tier_a: 0, tier_b: 2 });
  const replayWinner = sim.winner_side === 0 ? a.accountId : sim.winner_side === 1 ? b.accountId : null;
  ok(`replay: ${log.length} actions over ${sim.rounds} rounds, winner matches onchain: ${replayWinner === done.winner}`);
  ok(`ratings: A ${await view(addr.game, "rating_of", { account_id: a.accountId })}, B ${await view(addr.game, "rating_of", { account_id: b.accountId })}`);
  const ea = await view<{ available: string; locked: string }>(addr.game, "get_deck", { deck_id: da.id });
  const eb = await view<{ available: string; locked: string }>(addr.game, "get_deck", { deck_id: db.id });
  ok(`escrow after settlement: A ${Number(ea.available) / 1e6}, B ${Number(eb.available) / 1e6} tUSD (locked ${ea.locked}/${eb.locked})`);

  const quote = await view<{ principal_out: string; escrow_out: string }>(addr.game, "quote_withdraw", { deck_id: da.id, exit_asset: 1 });
  await a.callFunction({ contractId: addr.tnear, methodName: "storage_deposit", args: { account_id: a.accountId, registration_only: true }, deposit: 20n * 10n ** 21n, gas: T(30) });
  await a.callFunction({ contractId: addr.game, methodName: "withdraw", args: { deck_id: da.id, exit_asset: 1, min_out: "0" }, gas: T(60) });
  const nearBal = await view<string>(addr.tnear, "ft_balance_of", { account_id: a.accountId });
  ok(`A withdrew to tNEAR: quoted ${Number(BigInt(quote.principal_out) + BigInt(quote.escrow_out)) / 1e24}, received ${Number(nearBal) / 1e24} tNEAR`);
  const retired = await view<{ retired: boolean }>(addr.game, "get_deck", { deck_id: da.id });
  ok(`deck #${da.id} retired: ${retired.retired}`);

  // One-signature pool flows (player B)
  await b.callFunction({ contractId: addr.tnear, methodName: "claim", args: {}, gas: T(30) });
  const bal = async (token: string, who: string) => BigInt(await view<string>(token, "ft_balance_of", { account_id: who }));
  const before = await bal(addr.tnear, b.accountId);
  await b.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.pool, amount: "10000000", msg: JSON.stringify({ action: "swap", min_out: "0" }) }, deposit: 1n, gas: T(100) });
  const gained = (await bal(addr.tnear, b.accountId)) - before;
  const [pu, pn] = await view<[string, string]>(addr.pool, "balances_of", { account_id: b.accountId });
  ok(`swap in one signature: 10 tUSD -> ${Number(gained) / 1e24} tNEAR in wallet, pool balance left ${pu}/${pn}`);
  if (gained <= 0n || pu !== "0" || pn !== "0") throw new Error("one-signature swap did not settle cleanly");

  const addMsg = JSON.stringify({ action: "add", tusd_min: "0", tnear_min: "0" });
  const [rU, rN] = await view<[string, string]>(addr.pool, "reserves");
  const useU = 50_000_000n, useN = (useU * BigInt(rN)) / BigInt(rU);
  await b.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.pool, amount: useU.toString(), msg: addMsg }, deposit: 1n, gas: T(100) });
  const mid = await view<{ shares: string }>(addr.pool, "position_of", { account_id: b.accountId });
  await b.callFunction({ contractId: addr.tnear, methodName: "ft_transfer_call", args: { receiver_id: addr.pool, amount: useN.toString(), msg: addMsg }, deposit: 1n, gas: T(100) });
  const pos = await view<{ shares: string; tusd: string; tnear: string }>(addr.pool, "position_of", { account_id: b.accountId });
  ok(`add liquidity: shares after first token ${mid.shares}, after second ${pos.shares}`);
  if (mid.shares !== "0" || pos.shares === "0") throw new Error("add did not wait for the second token and then run");

  const tusdBefore = await bal(addr.tusd, b.accountId);
  await b.signAndSendTransaction({ receiverId: addr.pool, actions: [
    actions.functionCall("remove_liquidity", { shares: pos.shares, tusd_min: "0", tnear_min: "0" }, T(40), 0n),
    actions.functionCall("withdraw_all", {}, T(80), 0n),
  ] });
  const after = await view<{ shares: string }>(addr.pool, "position_of", { account_id: b.accountId });
  const [bu, bn] = await view<[string, string]>(addr.pool, "balances_of", { account_id: b.accountId });
  ok(`remove + withdraw in one transaction: shares ${after.shares}, pool balance ${bu}/${bn}, tUSD back +${Number((await bal(addr.tusd, b.accountId)) - tusdBefore) / 1e6}`);
  if (after.shares !== "0" || bu !== "0" || bn !== "0") throw new Error("remove + withdraw_all left funds in the pool");
  console.log("E2E OK");
}
main().catch((e) => { console.error("E2E FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
