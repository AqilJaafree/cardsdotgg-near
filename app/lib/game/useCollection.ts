"use client";
import { useMemo } from "react";
import { A } from "../contracts";
import { useView } from "../useView";
import { useWallet } from "../wallet";
import { decks } from "./catalog";

/** What the contract returns for `get_collection`: only what was unlocked from packs. */
export type CollectionJson = { creatures: number[]; pictures: number[]; opened: number; last_pack: { pictures: number[]; creature: number } | null };

/** The 24 pictures printed on the starter decks. A deck can always use them, and they give no perk. */
export const STARTER_PICS = new Set<number>(decks.flatMap((d) => [...d.cards]));

/** Max-HP perk, in percent, of a picture unlocked from a pack. Mirrors `hp_bonus_pct` in near/game/src/collection.rs. */
export const hpBonus = (pic: number) => (pic >= 1 && pic <= 22 ? 5 : pic >= 23 && pic <= 42 ? 2 : 0);

/** The rarity the game uses for a picture (same bands as the contract), which decides its perk. */
export const rarityName = (pic: number) => (pic >= 1 && pic <= 22 ? "Rare" : pic >= 23 && pic <= 42 ? "Uncommon" : "Common");

/** The player's onchain collection: pictures and creatures unlocked from packs. */
export function useCollection() {
  const { accountId } = useWallet();
  const res = useView<CollectionJson>(A.game, "get_collection", accountId ? { account_id: accountId } : undefined, { enabled: !!accountId && !!A.game, interval: 30000 });
  const data = res.data;
  return useMemo(() => {
    const pictures = new Set<number>(data?.pictures ?? []);
    const creatures = new Set<number>(data?.creatures ?? []);
    const usable = new Set<number>([...STARTER_PICS, ...pictures]);
    return {
      /** Pictures unlocked from packs (these give the HP perk). */
      pictures,
      /** Creatures unlocked from packs (a deck's own tier is always usable on top of these). */
      creatures,
      /** Every picture a deck may use: the starters plus the unlocked ones. */
      usable,
      opened: data?.opened ?? 0,
      last: data?.last_pack ?? null,
      loading: !data && !res.error,
      error: res.error,
      refetch: res.refetch,
    };
  }, [data, res.error, res.refetch]);
}
