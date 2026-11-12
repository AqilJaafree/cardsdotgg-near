"use client";
import { useEffect, useState } from "react";
import { A, type DeckJson } from "./contracts";
import { view } from "./near";
import { useView } from "./useView";
import { useWallet } from "./wallet";

export type DeckView = { id: bigint; tier: number; asset: number; principal: bigint; valueUsd: bigint; retired: boolean; available: bigint; locked: bigint; seeded: bigint; uri?: string };

const svgCache = new Map<string, string>();

export function useDecks() {
  const { accountId } = useWallet();
  const res = useView<DeckJson[]>(A.game, "decks_of", accountId ? { account_id: accountId } : undefined, { enabled: !!accountId && !!A.game, interval: 8000 });
  const decks: DeckView[] = (res.data ?? []).map((d) => ({
    id: BigInt(d.id), tier: d.tier, asset: d.asset, principal: BigInt(d.principal), valueUsd: BigInt(d.deposit_value_usd),
    retired: d.retired, available: BigInt(d.available), locked: BigInt(d.locked), seeded: BigInt(d.seeded),
  }));
  const [uris, setUris] = useState<Record<string, string>>({});
  const ids = decks.map((d) => `${d.id}:${d.retired}`).join(",");
  useEffect(() => {
    let live = true;
    decks.forEach(async (d) => {
      const k = `${d.id}:${d.retired}`;
      if (svgCache.has(k)) { setUris((u) => (u[k] ? u : { ...u, [k]: svgCache.get(k)! })); return; }
      try {
        const svg = await view<string>(A.game, "deck_svg", { deck_id: String(d.id) });
        const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
        svgCache.set(k, uri);
        if (live) setUris((u) => ({ ...u, [k]: uri }));
      } catch { /* the deck still renders without its card image */ }
    });
    return () => { live = false; };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return { decks: decks.map((d) => ({ ...d, uri: uris[`${d.id}:${d.retired}`] })), refetch: res.refetch };
}
