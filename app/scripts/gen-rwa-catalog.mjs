// Builds lib/game/rwa-catalog.json from the physical-card photos in public/cards/wf-token (one file per card held).
// Token id = position in set-number order; the same order is loaded on-chain by `keeper: pnpm set-rwa-stock`.
// Run from app/: node scripts/gen-rwa-catalog.mjs
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../public/cards/wf-token");
const cards = readdirSync(dir)
  .map((f) => ({ f, m: f.match(/^(.+)\.(SV11W)\.(\d+)\.(\d+)\.jpe?g$/i) }))
  .filter((x) => x.m)
  .map(({ f, m }) => ({ name: m[1].replace(/-/g, " "), set: m[2].toUpperCase(), number: Number(m[3]), src: `/cards/wf-token/${f}` }))
  .sort((a, b) => a.number - b.number)
  .map((c, id) => ({ id, ...c, card: `${c.set} ${String(c.number).padStart(3, "0")} ${c.name}` }));
writeFileSync(join(here, "../lib/game/rwa-catalog.json"), JSON.stringify(cards, null, 2) + "\n");
console.log(`wrote ${cards.length} physical cards`);
