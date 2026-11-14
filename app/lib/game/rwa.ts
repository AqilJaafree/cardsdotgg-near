"use client";
import data from "./rwa-catalog.json";
import { A } from "../contracts";
import { useView } from "../useView";

/** One physical card behind a token: photo, set and number. Token id = index (the order loaded on-chain). */
export type RwaCard = { id: number; name: string; set: string; number: number; src: string; card: string };
export const rwaCards = data as RwaCard[];
export const rwaCard = (id: number): RwaCard | undefined => rwaCards[id];

/** What the contract returns for a token (`rwa_all`, `rwa_tokens_of`). `owner` is null while the card is still in stock. */
export type RwaTokenJson = { id: number; card: string; owner: string | null; minted_at: number | null; redeemed: boolean };
export type RwaStockJson = { total: number; remaining: number };

/** How many physical cards the season pack still holds. */
export function useRwaStock() {
  return useView<RwaStockJson>(A.game, "rwa_stock", {}, { enabled: !!A.game, interval: 20000 });
}
