// Owner only: load the physical cards behind the season pack, from app/lib/game/rwa-catalog.json (token id = index).
// Allowed only before any card has been pulled. Env: NEAR_OWNER_ID, NEAR_OWNER_KEY.
import { readFileSync } from "node:fs";
import { Account } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const cards = (JSON.parse(readFileSync(new URL("../../app/lib/game/rwa-catalog.json", import.meta.url), "utf8")) as { card: string }[]).map((c) => c.card);
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const owner = new Account(ownerId, rpc, ownerKey);

async function main() {
  await owner.callFunction({ contractId: addr.game, methodName: "set_rwa_stock", args: { cards }, gas: 50n * 10n ** 12n });
  const view = (method: string) => owner.provider.callFunction({ contractId: addr.game, method, args: {} } as never);
  console.log("stock:", JSON.stringify(await view("rwa_stock")));
  console.log("tokens:", (await view("rwa_all") as { id: number; card: string }[]).map((t) => `#${t.id} ${t.card}`).join(", "));
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
