// Owner only: NEP-177 image paths for the physical-card NFTs, from app/lib/game/rwa-catalog.json (token id = index).
// NFT_BASE_URI: where the app is hosted (e.g. https://your-app.vercel.app); images are base_uri + "/" + media.
// BACKFILL=1 also logs nft_mint for tokens minted before the NFT layer, so wallets and indexers pick them up.
// Env: NEAR_OWNER_ID, NEAR_OWNER_KEY.
import { readFileSync } from "node:fs";
import { Account } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const media = (JSON.parse(readFileSync(new URL("../../app/lib/game/rwa-catalog.json", import.meta.url), "utf8")) as { src: string }[]).map((c) => c.src.replace(/^\//, ""));
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const owner = new Account(ownerId, rpc, ownerKey);
const T = (n: number) => BigInt(n) * 10n ** 12n;

async function main() {
  const base = process.env.NFT_BASE_URI?.replace(/\/$/, "") || null;
  await owner.callFunction({ contractId: addr.game, methodName: "set_nft_config", args: { base_uri: base, media, icon: null }, gas: T(50) });
  if (process.env.BACKFILL === "1") await owner.callFunction({ contractId: addr.game, methodName: "nft_backfill_mint_events", args: {}, gas: T(50) });
  const view = (method: string, args: object = {}) => owner.provider.callFunction({ contractId: addr.game, method, args } as never);
  console.log("nft_metadata:", JSON.stringify(await view("nft_metadata")));
  console.log("nft_total_supply:", JSON.stringify(await view("nft_total_supply")));
  for (const t of (await view("nft_tokens", {})) as { token_id: string; owner_id: string; metadata: { title: string; media: string } }[])
    console.log(`  #${t.token_id} ${t.metadata.title} -> ${t.owner_id} (${t.metadata.media})`);
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
