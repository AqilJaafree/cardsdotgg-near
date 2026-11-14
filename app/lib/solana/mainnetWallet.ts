"use client";
// A second NEAR wallet connection, on MAINNET, used only to pay for Solana cards through NEAR Intents.
// The game itself stays on testnet (lib/wallet.tsx). This connector keeps its sign-in under its own storage keys, so
// connecting or disconnecting here never touches the testnet session.
import { useCallback, useEffect, useRef, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { ORIGIN } from "./intents";

type Wallet = Awaited<ReturnType<NearConnector["connect"]>>;

const PREFIX = "cardsdotgg.mainnet.";
const storage = {
  get: async (k: string) => { try { return localStorage.getItem(PREFIX + k); } catch { return null; } },
  set: async (k: string, v: string) => { try { localStorage.setItem(PREFIX + k, v); } catch { /* storage may be blocked */ } },
  remove: async (k: string) => { try { localStorage.removeItem(PREFIX + k); } catch { /* storage may be blocked */ } },
};

const WRAP = ORIGIN.replace(/^nep141:/, "");                 // wrap.near
const STORAGE_DEPOSIT = "1250000000000000000000";           // 0.00125 NEAR: wrap.near account registration
const TGAS = (n: number) => String(BigInt(n) * 10n ** 12n);

let shared: Promise<NearConnector> | null = null;
function connector() {
  shared ??= import("@hot-labs/near-connect").then(({ NearConnector }) => new NearConnector({ network: "mainnet", storage, providers: { mainnet: ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"] } }));
  return shared;
}

export function useMainnetWallet() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const wallet = useRef<Wallet | null>(null);

  // Restore an earlier mainnet sign-in, if any (lazy: the connector loads only on the market page).
  useEffect(() => {
    let live = true;
    connector().then((c) => c.getConnectedWallet()).then((p) => {
      if (live && p) { wallet.current = p.wallet; setAccountId(p.accounts[0]?.accountId ?? null); }
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const connect = useCallback(async () => {
    const c = await connector();
    const w = await c.connect();
    wallet.current = w;
    const id = (await w.getAccounts())[0]?.accountId ?? null;
    setAccountId(id);
    return id;
  }, []);

  const disconnect = useCallback(async () => {
    const c = await connector();
    if (wallet.current) await c.disconnect(wallet.current).catch(() => {});
    wallet.current = null; setAccountId(null);
  }, []);

  /**
   * Pay a NEAR Intents quote: one transaction to wrap.near that registers both accounts (refunded if already
   * registered), wraps exactly `amountIn` yoctoNEAR into wNEAR and sends it to the quote's deposit address.
   */
  const payIntent = useCallback(async (depositAddress: string, amountIn: string) => {
    const w = wallet.current;
    if (!w || !accountId) throw new Error("Connect your NEAR mainnet wallet first");
    const call = (methodName: string, args: object, deposit: string, gas = 20) => ({ type: "FunctionCall" as const, params: { methodName, args, gas: TGAS(gas), deposit } });
    const out = await w.signAndSendTransaction({
      receiverId: WRAP,
      actions: [
        call("storage_deposit", { account_id: accountId, registration_only: true }, STORAGE_DEPOSIT),
        call("storage_deposit", { account_id: depositAddress, registration_only: true }, STORAGE_DEPOSIT),
        call("near_deposit", {}, amountIn),
        call("ft_transfer", { receiver_id: depositAddress, amount: amountIn, memo: "cardsdotgg: buy a graded card" }, "1", 30),
      ],
    } as never);
    return (out as { transaction?: { hash?: string } } | undefined)?.transaction?.hash;
  }, [accountId]);

  return { accountId, connect, disconnect, payIntent };
}
