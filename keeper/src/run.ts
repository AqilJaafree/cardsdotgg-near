// One-shot keeper: reads Rhea pools on NEAR mainnet, writes shared/rate-sources.json and shared/liquidity-source.json,
// and unless --dry calls set_rates and set_near_price on the testnet game contract.
// Env: KEEPER_ACCOUNT_ID, KEEPER_PRIVATE_KEY (ed25519:...), optional NEAR_MAINNET_RPC, NEAR_TESTNET_RPC.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { aprBps, assertSaneNear, clampBps, nearPriceFromReserves } from "./computeRates.js";
import { NEAR_MAINNET_RPC, NEAR_REFERENCE_POOL, RHEA_DEX_CONTRACT, RHEA_POOL_SEARCH, RHEA_POOL_URL, TIER_POOLS, WNEAR } from "./sources.js";

const root = new URL("../../", import.meta.url);
const dry = process.argv.includes("--dry");
const mainnetRpc = process.env.NEAR_MAINNET_RPC || NEAR_MAINNET_RPC;

type Row = { id: string; pool_kind: string; token_account_ids: string[]; token_symbols: string[]; amounts: string[]; tvl: string; volume_24h: string; fee_volume_24h: string; apy: string; total_fee: string };

async function json(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function rpc(method: string, params: unknown, url = mainnetRpc) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await r.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

/** View call on the Rhea DEX, used to check the indexer's reserves against the chain. */
async function getPool(poolId: string) {
  const args = Buffer.from(JSON.stringify({ pool_id: Number(poolId) })).toString("base64");
  const res = await rpc("query", { request_type: "call_function", finality: "final", account_id: RHEA_DEX_CONTRACT, method_name: "get_pool", args_base64: args });
  return JSON.parse(Buffer.from(res.result).toString()) as { token_account_ids: string[]; amounts: string[]; pool_kind: string };
}

async function main() {
  const status = await rpc("status", []);
  if (status.chain_id !== "mainnet") throw new Error("mainnet RPC is not NEAR mainnet");
  const block = await rpc("block", { finality: "final" });
  const readAt = new Date().toISOString();
  const blockHeight = String(block.header.height);

  const ids = [...TIER_POOLS.map((t) => t.poolId), NEAR_REFERENCE_POOL];
  const search = await json(`${RHEA_POOL_SEARCH}?pool_id_list=${[...new Set(ids)].join(",")}`);
  const rows = new Map<string, Row>((search.data.list as Row[]).map((r) => [r.id, r]));

  const entries = [];
  for (const t of TIER_POOLS) {
    const row = rows.get(t.poolId);
    if (!row) throw new Error(`Rhea pool ${t.poolId} missing from the indexer`);
    const chain = await getPool(t.poolId);
    if (chain.token_account_ids.join() !== row.token_account_ids.join()) throw new Error(`pool ${t.poolId}: indexer and chain disagree on tokens`);
    const raw = aprBps(row);
    const label = row.token_symbols.join("/");
    entries.push({
      tier: t.tier,
      bps: clampBps(raw),
      rawBps: raw,
      live: true,
      source: `Rhea ${row.pool_kind === "SIMPLE_POOL" ? "pool" : "stable pool"} #${row.id} ${label}`,
      sourceContract: RHEA_DEX_CONTRACT,
      sourceUrl: RHEA_POOL_URL(row.id),
      note: "Rhea's reported APY for the whole pool, from its 24h fee volume and TVL. It is the pool's rate, not what any one position earned, and ignores impermanent loss. Capped at 50%.",
      label,
      poolId: row.id,
      poolKind: row.pool_kind,
      feeFraction: row.total_fee,
      tvlUsd: Number(Number(row.tvl).toFixed(2)),
      volume24hUsd: Number(Number(row.volume_24h).toFixed(2)),
      feeVolume24hUsd: Number(Number(row.fee_volume_24h).toFixed(2)),
      readAt,
      nearBlock: blockHeight,
    });
    console.log(`tier ${t.tier}: ${raw} bps, Rhea #${row.id} ${label}, tvl $${Math.round(Number(row.tvl))}, vol24h $${Math.round(Number(row.volume_24h))}`);
  }
  writeFileSync(new URL("shared/rate-sources.json", root), JSON.stringify(entries, null, 2) + "\n");

  const ref = rows.get(NEAR_REFERENCE_POOL)!;
  const nearIdx = ref.token_account_ids.indexOf(WNEAR);
  if (nearIdx < 0 || ref.token_account_ids.length !== 2) throw new Error("reference pool must be USDC/wNEAR");
  const usdcIdx = 1 - nearIdx;
  if (ref.token_symbols[usdcIdx] !== "USDC") throw new Error(`unexpected quote token ${ref.token_symbols[usdcIdx]}`);
  const price = nearPriceFromReserves(BigInt(ref.amounts[usdcIdx]), BigInt(ref.amounts[nearIdx]));
  assertSaneNear(price);
  const near = {
    live: true,
    source: `Rhea pool #${ref.id} USDC/wNEAR, NEAR mainnet`,
    sourceContract: RHEA_DEX_CONTRACT,
    sourceUrl: RHEA_POOL_URL(ref.id),
    poolId: ref.id,
    nearToken: WNEAR,
    quoteToken: ref.token_account_ids[usdcIdx],
    usdPerNear1e6: price.toString(),
    nearReserve: ref.amounts[nearIdx],
    nearDecimals: 24,
    quoteReserve: ref.amounts[usdcIdx],
    quoteDecimals: 6,
    reserveValueUsd1e6: (BigInt(ref.amounts[usdcIdx]) * 2n).toString(),
    tvlUsd: Number(Number(ref.tvl).toFixed(2)),
    volume24hUsd: Number(Number(ref.volume_24h).toFixed(2)),
    feeFraction: ref.total_fee,
    note: "Read from Rhea on NEAR mainnet. USDC is treated as 1 USD. The testnet pool opens from this price and depth with test tokens; it does not hold or track real assets.",
    readAt,
    nearBlock: blockHeight,
  };
  writeFileSync(new URL("shared/liquidity-source.json", root), JSON.stringify(near, null, 2) + "\n");
  console.log(`NEAR: ${Number(price) / 1e6} USD, reference pool value ${Number(near.reserveValueUsd1e6) / 1e6} USD, 24h volume ${near.volume24hUsd}`);
  if (dry) return console.log("dry run: no transaction sent");

  const addrFile = new URL("shared/addresses.json", root);
  if (!existsSync(addrFile)) throw new Error("shared/addresses.json is missing, deploy first");
  const addresses = JSON.parse(readFileSync(addrFile, "utf8")) as { game: string; rpc: string };
  const accountId = process.env.KEEPER_ACCOUNT_ID, key = process.env.KEEPER_PRIVATE_KEY;
  if (!accountId || !key) throw new Error("KEEPER_ACCOUNT_ID and KEEPER_PRIVATE_KEY must be set");
  const { Account } = await import("near-api-js");
  const account = new Account(accountId, process.env.NEAR_TESTNET_RPC || addresses.rpc, key as `ed25519:${string}`);
  const gas = 30n * 10n ** 12n;
  await account.callFunction({ contractId: addresses.game, methodName: "set_rates", args: { guardian_bps: entries[0].bps, balanced_bps: entries[1].bps, degen_bps: entries[2].bps, source_block: Number(blockHeight) }, gas });
  console.log(`set_rates ok: ${entries.map((e) => e.bps).join(", ")} bps`);
  await account.callFunction({ contractId: addresses.game, methodName: "set_near_price", args: { usd_per_near_1e6: price.toString() }, gas });
  console.log(`set_near_price ok: ${Number(price) / 1e6} USD`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
