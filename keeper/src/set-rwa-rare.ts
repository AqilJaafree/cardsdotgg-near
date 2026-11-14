// Owner only: mark which physical cards are rare (printed Uncommon or above), from app/lib/game/rwa-catalog.json.
// The claw machine's odds use this: a won Season Ticket draws a rare card 75% of the time, a lost one 25%.
// Env: NEAR_OWNER_ID, NEAR_OWNER_KEY.
import { readFileSync } from "node:fs";
import { Account } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const ids = (JSON.parse(readFileSync(new URL("../../app/lib/game/rwa-catalog.json", import.meta.url), "utf8")) as { id: number; rare: boolean }[]).filter((c) => c.rare).map((c) => c.id);
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const owner = new Account(ownerId, rpc, ownerKey);

async function main() {
  await owner.callFunction({ contractId: addr.game, methodName: "set_rwa_rare", args: { ids }, gas: 30n * 10n ** 12n });
  const all = (await owner.provider.callFunction({ contractId: addr.game, method: "rwa_all", args: {} } as never)) as { id: number; card: string; rare: boolean; owner: string | null }[];
  console.log("rare:", all.filter((t) => t.rare).map((t) => `#${t.id} ${t.card}${t.owner ? " (pulled)" : ""}`).join(", "));
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
