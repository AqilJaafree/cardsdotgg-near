// Builds lib/game/rwa-catalog.json from the physical-card photos in public/cards/wf-token (one file per card held).
// Token id = position in set-number order; the same order is loaded on-chain by `keeper: pnpm set-rwa-stock`.
// Run from app/: node scripts/gen-rwa-catalog.mjs   (rare ids go on-chain with keeper: pnpm set-rwa-rare)
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Printed rarity mark on each card (bottom-left of the photo), by set number. Not in the file name, so kept here.
const RARITY = { 4: "C", 7: "U", 11: "C", 12: "C", 19: "C", 21: "C", 23: "U", 28: "C", 36: "C", 38: "C", 40: "R", 45: "U", 49: "C", 55: "U", 58: "C", 63: "C", 64: "U", 66: "C", 68: "U", 70: "C", 73: "C", 81: "C", 83: "U" };
const dir = join(here, "../public/cards/wf-token");
const cards = readdirSync(dir)
  .map((f) => ({ f, m: f.match(/^(.+)\.(SV11W)\.(\d+)\.(\d+)\.jpe?g$/i) }))
  .filter((x) => x.m)
  .map(({ f, m }) => ({ name: m[1].replace(/-/g, " "), set: m[2].toUpperCase(), number: Number(m[3]), src: `/cards/wf-token/${f}` }))
  .sort((a, b) => a.number - b.number)
  .map((c, id) => {
    const rarity = RARITY[c.number] ?? "C";
    // Uncommon and above count as rare for the claw machine's odds.
    return { id, ...c, card: `${c.set} ${String(c.number).padStart(3, "0")} ${c.name}`, rarity, rare: rarity !== "C" };
  });
writeFileSync(join(here, "../lib/game/rwa-catalog.json"), JSON.stringify(cards, null, 2) + "\n");
console.log(`wrote ${cards.length} physical cards`);
