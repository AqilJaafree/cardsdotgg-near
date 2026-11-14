"use client";
import { A } from "../contracts";
import { useView } from "../useView";
import { view } from "../near";
import { useWallet } from "../wallet";

/** What `get_tickets` returns. Pack Tickets open trial packs; Season Tickets (won / lost claw plays) open the season pack. */
export type TicketsJson = { pack: number; season_win: number; season_lose: number; claw_pending: number; free_left: number };

/** Same numbers as near/game/src/arcade.rs. */
export const ARCADE = { clawPrice: "2000000", freePerDay: 3, winRare: 75, loseRare: 25 } as const;

/** Fresh tickets straight from the chain (not the polled hook), for before/after checks around a transaction. */
export const fetchTickets = (accountId: string) => view<TicketsJson>(A.game!, "get_tickets", { account_id: accountId });

/**
 * Some wallets (Meteor) report "closed the window" or never answer even when the transaction went through, so the
 * chain is the judge: poll `check` until it is true or `tries` run out.
 */
export async function landed(check: () => Promise<boolean>, tries = 14, every = 900): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await check().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, every));
  }
  return false;
}

/** The signed-in player's arcade tickets. */
export function useTickets() {
  const { accountId } = useWallet();
  const res = useView<TicketsJson>(A.game, "get_tickets", accountId ? { account_id: accountId } : undefined, { enabled: !!accountId && !!A.game, interval: 20000 });
  const t = res.data;
  return { t, season: (t?.season_win ?? 0) + (t?.season_lose ?? 0), refetch: res.refetch, loaded: !!t };
}
