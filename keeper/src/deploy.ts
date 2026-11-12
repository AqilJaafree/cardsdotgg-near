// Deploys the NEAR contracts to testnet from an owner account and writes shared/addresses.json.
//   1. cd near && cargo build --target wasm32-unknown-unknown --release   (or: cargo near build non-reproducible-wasm per crate)
//   2. cd keeper && pnpm dry     (reads Rhea; the pool opens at that price and depth)
//   3. NEAR_OWNER_ID=you.testnet NEAR_OWNER_KEY=ed25519:... pnpm deploy-testnet
// CODE_ONLY=1 redeploys the wasm without touching state. RESUME=1 skips deploy and init and continues from registration and funding.
// Env: NEAR_OWNER_ID, NEAR_OWNER_KEY, optional KEEPER_ACCOUNT_ID (defaults to the owner), NEAR_TESTNET_RPC.
// NEAR holds one contract per account, so the owner account hosts the game contract and the two tokens and the pool each
// get a fresh implicit account (a 64-hex id funded by a transfer; sub-accounts are not allowed under hex accounts).
// Storage staking is about 1 NEAR per 100 KB of wasm, so the whole deploy needs roughly 9 testnet NEAR on the owner.
// Wasm is shrunk with binaryen first. Generated keys go to keeper/.deploy-keys.json (gitignored). Never prints keys.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Account, KeyPair } from "near-api-js";

const root = new URL("../../", import.meta.url);
const rpc = process.env.NEAR_TESTNET_RPC || "https://test.rpc.fastnear.com";
const ownerId = process.env.NEAR_OWNER_ID, ownerKey = process.env.NEAR_OWNER_KEY;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const keeperId = process.env.KEEPER_ACCOUNT_ID || ownerId;
const TGAS = (n: number) => BigInt(n) * 10n ** 12n;
const wasmFile = (name: string) => new URL(`near/target/wasm32-unknown-unknown/release/${name}.wasm`, root);
/** Optimised wasm bytes (binaryen -Oz), falling back to the raw build if wasm-opt is unavailable. */
function wasm(name: string): Uint8Array {
  const out = new URL(`near/target/wasm32-unknown-unknown/release/${name}.opt.wasm`, root);
  try {
    const bin = new URL("../node_modules/.bin/wasm-opt", import.meta.url);
    execFileSync(bin.pathname, ["-Oz", "--enable-bulk-memory", "--enable-sign-ext", "--enable-mutable-globals", "--enable-nontrapping-float-to-int", wasmFile(name).pathname, "-o", out.pathname]);
    return new Uint8Array(readFileSync(out));
  } catch {
    console.warn(`wasm-opt unavailable, deploying unoptimised ${name}`);
    return new Uint8Array(readFileSync(wasmFile(name)));
  }
}
const liquidity = JSON.parse(readFileSync(new URL("shared/liquidity-source.json", root), "utf8")) as { usdPerNear1e6: string; reserveValueUsd1e6: string };

const owner = new Account(ownerId as string, rpc, ownerKey as `ed25519:${string}`);
const keyFile = new URL("keeper/.deploy-keys.json", root);
const keys: Record<string, string> = existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, "utf8")) : {};
for (const n of ["tusd", "tnear", "pool", "funder"]) keys[n] ??= KeyPair.fromRandom("ed25519").toString();
writeFileSync(keyFile, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
const implicitId = (secret: string) => Buffer.from(KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().data).toString("hex");
const ids = { game: ownerId as string, tusd: implicitId(keys.tusd), tnear: implicitId(keys.tnear), pool: implicitId(keys.pool), funder: implicitId(keys.funder) };
const keyOf: Record<string, string> = { [ids.game]: ownerKey as string, [ids.tusd]: keys.tusd, [ids.tnear]: keys.tnear, [ids.pool]: keys.pool, [ids.funder]: keys.funder };
const as = (id: string) => new Account(id, rpc, keyOf[id] as `ed25519:${string}`);
const log = (m: string) => console.log(m);

/** Fund an implicit account for its code storage plus a working buffer, then deploy. */
async function createAndDeploy(id: string, crate: string) {
  const code = wasm(crate);
  if (id !== ownerId) {
    const have = await owner.provider.viewAccount({ accountId: id }).then((a) => BigInt(a.amount)).catch(() => 0n);
    const need = BigInt(code.length) * 10n ** 19n + 2n * 10n ** 23n; // 0.2 NEAR buffer
    if (have < need) await owner.transfer({ receiverId: id, amount: need - have });
  }
  await as(id).deployContract(code);
  log(`deployed ${crate} (${code.length} bytes) to ${id}`);
}

async function main() {
  const NEAR = 10n ** 24n;
  if (process.env.CODE_ONLY) { // replace the wasm on the existing accounts, keeping their state
    for (const [id, crate] of [[ids.tusd, "cardsdotgg_ft"], [ids.tnear, "cardsdotgg_ft"], [ids.game, "cardsdotgg_game"], [ids.pool, "cardsdotgg_pool"]]) await createAndDeploy(id, crate);
    return;
  }
  if (!process.env.RESUME) {
  await createAndDeploy(ids.tusd, "cardsdotgg_ft");
  await createAndDeploy(ids.tnear, "cardsdotgg_ft");
  await createAndDeploy(ids.game, "cardsdotgg_game");
  await createAndDeploy(ids.pool, "cardsdotgg_pool");

  await as(ids.tusd).callFunction({ contractId: ids.tusd, methodName: "new", args: { owner: ownerId, name: "Test USD (testnet)", symbol: "tUSD", decimals: 6, drip: "1000000000" }, gas: TGAS(30) });
  await as(ids.tnear).callFunction({ contractId: ids.tnear, methodName: "new", args: { owner: ownerId, name: "Test NEAR (testnet)", symbol: "tNEAR", decimals: 24, drip: (50n * NEAR).toString() }, gas: TGAS(30) });
  await as(ids.game).callFunction({ contractId: ids.game, methodName: "new", args: { owner: ownerId, keeper: keeperId, tusd: ids.tusd, tnear: ids.tnear, rates_bps: [500, 800, 1500], usd_per_near_1e6: liquidity.usdPerNear1e6 }, gas: TGAS(30) });
  await as(ids.pool).callFunction({ contractId: ids.pool, methodName: "new", args: { tusd: ids.tusd, tnear: ids.tnear }, gas: TGAS(30) });
  log("initialised all four contracts");
  } else log("RESUME: skipping deploy and init");

  // The game and pool contracts must be registered on both tokens before they can receive them; the owner too.
  const named = async <T,>(name: string, p: Promise<T>): Promise<T> => { try { const r = await p; log(`ok ${name}`); return r; } catch (e) { throw new Error(`${name}: ${(e as Error).message}`); } };
  const reg = (token: string, who: string) => named(`register ${who.slice(0, 8)} on ${token.slice(0, 8)}`, owner.callFunction({ contractId: token, methodName: "storage_deposit", args: { account_id: who, registration_only: true }, deposit: 20n * 10n ** 21n, gas: TGAS(30) }));
  for (const t of [ids.tusd, ids.tnear]) for (const w of [ids.game, ids.pool, ownerId as string]) await reg(t, w);

  // Working capital. The game contract lives on the owner account and NEP-141 forbids self-transfers, so a funder
  // account (fresh implicit account) sends the reserve and liquidity; the owner sends the pool's opening depth directly.
  const poolUsd = BigInt(liquidity.reserveValueUsd1e6) / 2n;
  const price = BigInt(liquidity.usdPerNear1e6);
  const poolNear = (poolUsd * NEAR) / price;
  const reserve = 1_000_000n * 10n ** 6n, liqUsd = 1_000_000n * 10n ** 6n, liqNear = 20_000n * NEAR;
  const bal = async (token: string, who: string) => BigInt(await owner.provider.callFunction({ contractId: token, method: "ft_balance_of", args: { account_id: who } } as never) as string);
  const mint = async (token: string, to: string, amount: bigint) => { if ((await bal(token, to)) < amount) await named(`mint on ${token.slice(0, 8)}`, owner.callFunction({ contractId: token, methodName: "mint", args: { to, amount: amount.toString() }, gas: TGAS(30) })); };
  const funderBal = await owner.provider.viewAccount({ accountId: ids.funder }).then((a) => BigInt(a.amount)).catch(() => 0n);
  if (funderBal < 5n * 10n ** 23n) await owner.transfer({ receiverId: ids.funder, amount: 10n ** 24n });
  for (const t of [ids.tusd, ids.tnear]) await named(`register funder on ${t.slice(0, 8)}`, owner.callFunction({ contractId: t, methodName: "storage_deposit", args: { account_id: ids.funder, registration_only: true }, deposit: 20n * 10n ** 21n, gas: TGAS(30) }));
  await mint(ids.tusd, ids.funder, reserve + liqUsd);
  await mint(ids.tnear, ids.funder, liqNear);
  await mint(ids.tusd, ownerId as string, poolUsd);
  await mint(ids.tnear, ownerId as string, poolNear);
  const from = (who: string) => (token: string, to: string, amount: bigint, msg: string) => named(`send ${amount} to ${to.slice(0, 8)} msg=${msg.slice(0, 20)}`, as(who).callFunction({ contractId: token, methodName: "ft_transfer_call", args: { receiver_id: to, amount: amount.toString(), msg }, deposit: 1n, gas: TGAS(100) }));
  const fund = from(ids.funder), send = from(ownerId as string);
  await fund(ids.tusd, ids.game, reserve, JSON.stringify({ action: "reserve" }));
  await fund(ids.tusd, ids.game, liqUsd, JSON.stringify({ action: "liquidity" }));
  await fund(ids.tnear, ids.game, liqNear, JSON.stringify({ action: "liquidity" }));
  await send(ids.tusd, ids.pool, poolUsd, "");
  await send(ids.tnear, ids.pool, poolNear, "");
  await named("add_liquidity", owner.callFunction({ contractId: ids.pool, methodName: "add_liquidity", args: { tusd_desired: poolUsd.toString(), tnear_desired: poolNear.toString(), tusd_min: poolUsd.toString(), tnear_min: poolNear.toString() }, gas: TGAS(60) }));
  log(`funded reserve ${reserve / 10n ** 6n} tUSD and opened the pool with ${poolUsd / 10n ** 6n} tUSD / ${poolNear / NEAR} tNEAR`);

  const addresses = { network: "testnet", rpc, explorer: "https://testnet.nearblocks.io", ...ids, owner: ownerId, keeper: keeperId };
  writeFileSync(new URL("shared/addresses.json", root), JSON.stringify(addresses, null, 2) + "\n");
  log("wrote shared/addresses.json. Next: pnpm run-once (keeper) to write live Rhea rates and the NEAR price.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
