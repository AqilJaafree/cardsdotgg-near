// End-to-end packs on NEAR testnet with one fresh player: claim tUSD, buy a pack, check what unlocked, then check the
// contract only lets a deck use what the player owns. Env: NEAR_OWNER_ID, NEAR_OWNER_KEY. Never prints keys.
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
const refused = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return String((e as Error).message ?? e); } };

type Col = { creatures: number[]; pictures: number[]; opened: number; last_pack: { pictures: number[]; creature: number } | null };

async function main() {
  const kp = KeyPair.fromRandom("ed25519");
  const id = Buffer.from(kp.getPublicKey().data).toString("hex");
  const bal = await funder.provider.viewAccount({ accountId: funder.accountId }).then((x) => BigInt(x.amount)).catch(() => 0n);
  await (bal > 3n * 10n ** 23n ? funder : owner).transfer({ receiverId: id, amount: 15n * 10n ** 22n });
  const p = new Account(id, rpc, kp.toString() as `ed25519:${string}`);
  ok(`player funded ${id.slice(0, 8)}`);
  await p.callFunction({ contractId: addr.tusd, methodName: "claim", args: {}, gas: T(30) });

  const price = await view<string>(addr.game, "pack_price");
  assert((await view<Col>(addr.game, "get_collection", { account_id: id })).opened === 0, "starts with no packs");
  ok(`pack price ${Number(price) / 1e6} tUSD`);
  // too little is refused (the whole transfer is returned)
  await p.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.game, amount: String(Number(price) - 1), msg: '{"action":"pack"}' }, deposit: 1n, gas: T(70) }).catch(() => {});
  assert((await view<Col>(addr.game, "get_collection", { account_id: id })).opened === 0, "an underpaid pack opens nothing");
  ok("underpaying did not open a pack");

  const before = BigInt(await view<string>(addr.tusd, "ft_balance_of", { account_id: id }));
  await p.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.game, amount: price, msg: '{"action":"pack"}' }, deposit: 1n, gas: T(70) });
  const after = BigInt(await view<string>(addr.tusd, "ft_balance_of", { account_id: id }));
  const col = await view<Col>(addr.game, "get_collection", { account_id: id });
  assert(col.opened === 1 && col.last_pack, "one pack opened");
  assert(before - after === BigInt(price), `exactly the price was taken (took ${before - after})`);
  assert(col.last_pack!.pictures.every((x) => col.pictures.includes(x)) && col.creatures.includes(col.last_pack!.creature), "the pack's cards are unlocked");
  ok(`bought a pack: pictures ${JSON.stringify(col.last_pack!.pictures)}, creature ${col.last_pack!.creature}; took ${Number(before - after) / 1e6} tUSD`);

  // a deck: Guardian (tier 0). Its own creatures are free to use; others must be unlocked.
  await p.callFunction({ contractId: addr.tusd, methodName: "ft_transfer_call", args: { receiver_id: addr.game, amount: "20000000", msg: '{"action":"deposit","tier":0}' }, deposit: 1n, gas: T(100) });
  const [deck] = await view<{ id: string }[]>(addr.game, "decks_of", { account_id: id });
  const set = (cards: number[], art: number[]) => p.callFunction({ contractId: addr.game, methodName: "set_deck_cards", args: { deck_id: deck.id, cards, art }, gas: T(30) });
  const starters = [0, 1, 2, 3, 4, 5, 6, 7];
  const notOwned = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => c + 8).find((c) => !col.creatures.includes(c))!;     // a Balanced creature not unlocked
  const lockedPic = [60, 61, 62, 63, 64, 65].find((x) => !col.pictures.includes(x))!;
  let e = await refused(set([notOwned, ...starters.slice(1)], Array(8).fill(0)));
  assert(/creature not unlocked/.test(e), `an unowned creature must be refused, got: ${e.slice(0, 100)}`);
  e = await refused(set(starters, [lockedPic, 0, 0, 0, 0, 0, 0, 0]));
  assert(/picture not unlocked/.test(e), `an unowned picture must be refused, got: ${e.slice(0, 100)}`);
  ok("an unowned creature and an unowned picture were both refused");
  // use a picture that really came from the pack (not one of the 24 starter pictures), so the perk applies
  const STARTER = [15, 2, 1, 3, 13, 17, 30, 44, 14, 9, 16, 20, 21, 22, 58, 27, 4, 10, 12, 6, 8, 7, 5, 11];
  const fromPack = col.last_pack!.pictures.filter((x) => !STARTER.includes(x)).sort((a, b) => (a <= 22 ? 0 : a <= 42 ? 1 : 2) - (b <= 22 ? 0 : b <= 42 ? 1 : 2))[0];
  await set(starters, [fromPack, 0, 0, 0, 0, 0, 0, 0]);
  let saved = { art: [] as number[] };
  for (let i = 0; i < 10 && saved.art[0] !== fromPack; i++) {          // reads can lag a block behind the write
    await new Promise((r) => setTimeout(r, 1000));
    saved = await view<{ art: number[] }>(addr.game, "get_deck_cards", { deck_id: deck.id });
  }
  assert(saved.art[0] === fromPack, "the unlocked picture was saved");
  const perk = fromPack <= 22 ? 5 : fromPack <= 42 ? 2 : 0;
  ok(`saved a deck using the unlocked picture #${fromPack} (+${perk}% max HP perk)`);
  console.log("E2E PACKS PASSED");
}
main().catch((e) => { console.error(String((e as Error).message ?? e).replace(/ed25519:[A-Za-z0-9]+/g, "ed25519:<hidden>")); process.exit(1); });
