// End-to-end season pack on NEAR testnet with one fresh player: the season is open and a season pack mints exactly one
// physical-card token, nothing else. Env: NEAR_OWNER_ID, NEAR_OWNER_KEY. Never prints keys.
import { existsSync, readFileSync } from "node:fs";
import { Account, KeyPair } from "near-api-js";

const addr = JSON.parse(readFileSync(new URL("../../shared/addresses.json", import.meta.url), "utf8")) as Record<string, string>;
const rpc = process.env.NEAR_TESTNET_RPC || addr.rpc;
const ownerId = process.env.NEAR_OWNER_ID as string, ownerKey = process.env.NEAR_OWNER_KEY as `ed25519:${string}`;
if (!ownerId || !ownerKey) throw new Error("NEAR_OWNER_ID and NEAR_OWNER_KEY must be set");
const T = (n: number) => BigInt(n) * 10n ** 12n;
const owner = new Account(ownerId, rpc, ownerKey);
const keyFile = new URL("../.deploy-keys.json", import.meta.url);
const funderKey = existsSync(keyFile) ? (JSON.parse(readFileSync(keyFile, "utf8")) as Record<string, string>).funder : undefined;
const funder = funderKey ? new Account(addr.funder, rpc, funderKey as `ed25519:${string}`) : owner;
const view = async <X,>(contractId: string, method: string, args: object = {}) => (await owner.provider.callFunction({ contractId, method, args } as never)) as X;
const ok = (m: string) => console.log("ok  ", m);
const assert = (c: unknown, m: string) => { if (!c) throw new Error("FAILED: " + m); };
type Col = { creatures: number[]; pictures: number[]; opened: number; last_pack: { pictures: number[]; creature: number } | null };

async function main() {
  // Each season pack now mints one of the real physical cards to the buyer, and the stock cannot be reloaded once a
  // card is out, so this test only runs when you explicitly accept giving one card to a throwaway test account.
  if (process.env.CONSUME_STOCK !== "1") throw new Error("this test pulls one real physical card from the stock; rerun with CONSUME_STOCK=1 to accept");
  const s = await view<{ name: string; start: number; end: number; now: number; open: boolean } | null>(addr.game, "get_season");
  assert(s && s.open, `the season must be open, got ${JSON.stringify(s)}`);
  ok(`season "${s!.name}" open, ${Math.round((s!.end - s!.now) / 86400)} days left`);

  const kp = KeyPair.fromRandom("ed25519");
  const id = Buffer.from(kp.getPublicKey().data).toString("hex");
  const bal = await funder.provider.viewAccount({ accountId: funder.accountId }).then((x) => BigInt(x.amount)).catch(() => 0n);
  await (bal > 3n * 10n ** 23n ? funder : owner).transfer({ receiverId: id, amount: 15n * 10n ** 22n });
  const p = new Account(id, rpc, kp.toString() as `ed25519:${string}`);
  await p.callFunction({ contractId: addr.tusd, methodName: "claim", args: {}, gas: T(30) });
  ok(`player funded ${id.slice(0, 8)}`);

  const before = BigInt(await view<string>(addr.tusd, "ft_balance_of", { account_id: id }));
  await p.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.game, amount: "2000000", msg: '{"action":"season_pack"}' }, deposit: 1n, gas: T(70) });
  const after = BigInt(await view<string>(addr.tusd, "ft_balance_of", { account_id: id }));
  const col = await view<Col>(addr.game, "get_collection", { account_id: id });
  assert(before - after === 2_000_000n, `exactly 2 tUSD was taken (took ${before - after})`);
  assert(col.opened === 0 && col.pictures.length === 0 && col.creatures.length === 0, "a season pack gives no pictures or creature");
  const tokens = await view<{ id: number; card: string; redeemed: boolean }[]>(addr.game, "rwa_tokens_of", { account_id: id });
  assert(tokens.length === 1 && !tokens[0].redeemed, `exactly one physical-card token, got ${JSON.stringify(tokens)}`);
  ok(`season pack minted token #${tokens[0].id} (${tokens[0].card}) and nothing else`);
  console.log("E2E SEASON PASSED");
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
