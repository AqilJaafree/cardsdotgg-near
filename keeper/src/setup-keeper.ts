// One-off: creates a separate keeper account so the owner key never runs in the always-on services.
// Generates a key, funds the implicit account from the owner, calls set_keeper on the game, writes KEEPER_ACCOUNT_ID and
// KEEPER_PRIVATE_KEY into the repo's .env (mode 600). Never prints a key.
//   pnpm --filter keeper setup-keeper        (env loaded from ../.env by the runner, or exported)
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { Account, KeyPair } from "near-api-js";

const envPath = new URL("../../.env", import.meta.url);
const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID, ownerKey = process.env.NEAR_OWNER_KEY;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID / NEAR_OWNER_KEY missing");
const FUND = 2n * 10n ** 24n; // 2 NEAR

const pair = KeyPair.fromRandom("ed25519");
const id = Buffer.from(pair.getPublicKey().data).toString("hex");
const owner = new Account(ownerId, rpc, ownerKey as `ed25519:${string}`);

await owner.transfer({ receiverId: id, amount: FUND });
await owner.callFunction({ contractId: addr.game, methodName: "set_keeper", args: { keeper: id }, gas: 30n * 10n ** 12n });

let env = readFileSync(envPath, "utf8");
const set = (k: string, v: string) => { env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`; };
set("KEEPER_ACCOUNT_ID", id);
set("KEEPER_PRIVATE_KEY", pair.toString());
writeFileSync(envPath, env, { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(`keeper ${id.slice(0, 8)}… funded with 2 NEAR and set on the game; .env updated`);
