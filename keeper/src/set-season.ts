// Owner only: open the limited-time season pack. Env: NEAR_OWNER_ID, NEAR_OWNER_KEY.
// SEASON_NAME (default "White Flame"), SEASON_DAYS (default 60, about two months), SEASON_START (unix seconds, default now).
import { readFileSync } from "node:fs";
import { Account } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const owner = new Account(ownerId, rpc, ownerKey);

async function main() {
  const name = process.env.SEASON_NAME || "White Flame";
  const start = Number(process.env.SEASON_START || Math.floor(Date.now() / 1000));
  const end = start + Number(process.env.SEASON_DAYS || 60) * 86400;
  await owner.callFunction({ contractId: addr.game, methodName: "set_season", args: { name, start: String(start), end: String(end) }, gas: 30n * 10n ** 12n });
  const s = await owner.provider.callFunction({ contractId: addr.game, method: "get_season", args: {} } as never);
  console.log("season set:", JSON.stringify(s), `(${new Date(start * 1000).toISOString()} to ${new Date(end * 1000).toISOString()})`);
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
