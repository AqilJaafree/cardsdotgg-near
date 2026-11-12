// Copies shared/ data into app/lib/shared (gitignored). Addresses and Rhea data come only from shared/.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
const src = new URL("../../shared/", import.meta.url), dst = new URL("../lib/shared/", import.meta.url);
mkdirSync(dst, { recursive: true });
cpSync(new URL("cards.json", src), new URL("cards.json", dst));
for (const f of ["addresses.json", "rate-sources.json", "liquidity-source.json"]) {
  if (existsSync(new URL(f, src))) cpSync(new URL(f, src), new URL(f, dst));
  else { writeFileSync(new URL(f, dst), f === "rate-sources.json" ? "[]" : "{}"); console.warn(`shared/${f} missing, wrote empty`); }
}
