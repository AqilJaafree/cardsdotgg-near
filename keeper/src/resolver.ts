// Match resolver: watches the game contract and resolves every match whose seed block has passed, so players never
// sign a "resolve" transaction. It also closes open challenges once their hour is up, which frees the locked stake.
//   pnpm resolve          one pass, then exit (cron friendly)
//   pnpm resolve:watch    keep running, polling every few seconds
// Env: KEEPER_ACCOUNT_ID and KEEPER_PRIVATE_KEY (any funded account works, resolve and expire are open to everyone;
// falls back to NEAR_OWNER_ID / NEAR_OWNER_KEY), optional NEAR_TESTNET_RPC, RESOLVE_POLL_MS. Never prints keys.
import { readFileSync } from "node:fs";
import { Account } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
if (!addr.game) throw new Error("shared/addresses.json has no game contract, deploy first");
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const accountId = process.env.KEEPER_ACCOUNT_ID || process.env.NEAR_OWNER_ID;
const key = process.env.KEEPER_PRIVATE_KEY || process.env.NEAR_OWNER_KEY;
if (!accountId || !key) throw new Error("set KEEPER_ACCOUNT_ID and KEEPER_PRIVATE_KEY (or NEAR_OWNER_ID and NEAR_OWNER_KEY)");
const watch = process.argv.includes("--watch");
const pollMs = Number(process.env.RESOLVE_POLL_MS || 4000);
const TTL = 3600;
const T = (n: number) => BigInt(n) * 10n ** 12n;

const account = new Account(accountId, rpc, key as `ed25519:${string}`);
type M = { id: string; status: number; seed_block: string; created_at: string };
const view = async <X,>(method: string, args: object = {}) => (await account.provider.callFunction({ contractId: addr.game, method, args } as never)) as X;
const stamp = () => new Date().toISOString().slice(11, 19);
const busy = new Set<string>();

async function act(m: M, methodName: "resolve" | "expire") {
  const k = `${methodName}:${m.id}`;
  if (busy.has(k)) return;
  busy.add(k);
  try {
    await account.callFunction({ contractId: addr.game, methodName, args: { match_id: m.id }, gas: T(methodName === "resolve" ? 150 : 40) });
    console.log(`${stamp()} ${methodName} match #${m.id} ok`);
  } catch (e) {
    // Someone else got there first, or the state moved on. The next pass re-reads, so this is not fatal.
    console.log(`${stamp()} ${methodName} match #${m.id} skipped: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
  } finally {
    busy.delete(k);
  }
}

async function pass() {
  const [height, matches] = await Promise.all([
    account.provider.viewBlock({ finality: "final" }).then((b) => BigInt(b.header.height)),
    view<M[]>("recent_matches", { limit: 50 }),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const work: Promise<void>[] = [];
  for (const m of matches) {
    if (m.status === 1 && height > BigInt(m.seed_block)) work.push(act(m, "resolve"));
    else if (m.status === 0 && now >= Number(m.created_at) + TTL) work.push(act(m, "expire"));
  }
  await Promise.all(work);
  return work.length;
}

async function main() {
  console.log(`${stamp()} resolver for ${addr.game.slice(0, 8)}… as ${(accountId as string).slice(0, 8)}…${watch ? `, polling every ${pollMs} ms` : ""}`);
  if (!watch) {
    console.log(`${stamp()} handled ${await pass()} matches`);
    return;
  }
  let backoff = 0; // grows while the RPC rate limits us, resets on the first good pass
  for (;;) {
    try { await pass(); backoff = 0; } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      backoff = /429|rate limit/i.test(m) ? Math.min(60000, (backoff || 5000) * 2) : 0;
      console.log(`${stamp()} pass failed: ${m.slice(0, 100)}${backoff ? ` (backing off ${backoff / 1000}s)` : ""}`);
    }
    await new Promise((r) => setTimeout(r, pollMs + backoff));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
