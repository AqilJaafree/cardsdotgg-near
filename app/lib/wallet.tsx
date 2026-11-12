"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK_ID } from "./chain";
import { A } from "./contracts";

export type Act = { methodName: string; args?: object; deposit?: string; gas?: string };
/** One transaction to one contract. `then` adds more actions to the same transaction: one signature, all or nothing. */
export type CallArgs = Act & { receiverId: string; then?: Act[] };
type Ctx = {
  ready: boolean; error: string | null; clearError: () => void; accountId: string | null; signIn: () => void; signOut: () => Promise<void>;
  /** Signs and sends one transaction, or several (an array) behind a single wallet approval. Returns the last
   *  transaction hash, or nothing when the wallet redirects away. */
  call: (c: CallArgs | CallArgs[]) => Promise<{ hash?: string; failure?: string }>;
};
const WalletCtx = createContext<Ctx | null>(null);
export const useWallet = () => {
  const c = useContext(WalletCtx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
};

/**
 * NEAR wallet sign-in through @hot-labs/near-connect (the connector NEAR's own template uses). Wallets run in
 * sandboxed frames, so there is no pop-up to get blocked. Every contract write goes through `call`.
 */
type ConnectedWallet = Awaited<ReturnType<NearConnector["wallet"]>>;

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connector, setConnector] = useState<NearConnector>();
  const [wallet, setWallet] = useState<ConnectedWallet>();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const slow = setTimeout(() => setError((cur) => cur ?? "The wallet is taking too long to load. Check your connection or reload the page."), 10000);
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({
        network: NETWORK_ID,
        providers: { mainnet: ["https://free.rpc.fastnear.com"], testnet: ["https://test.rpc.fastnear.com"] },
      });
      const onIn = (p: { wallet: ConnectedWallet; accounts: { accountId: string }[] }) => {
        if (cancelled) return;
        setWallet(p.wallet); setAccountId(p.accounts[0]?.accountId ?? null); setError(null);
      };
      const onOut = () => { if (!cancelled) { setWallet(undefined); setAccountId(null); } };
      c.on("wallet:signIn", onIn as never);
      c.on("wallet:signOut", onOut as never);
      cleanup = () => { c.off("wallet:signIn", onIn as never); c.off("wallet:signOut", onOut as never); };
      const prev = await c.getConnectedWallet().catch(() => null);
      if (cancelled) return;
      if (prev) { setWallet(prev.wallet); setAccountId(prev.accounts[0]?.accountId ?? null); }
      clearTimeout(slow);
      setConnector(c);
    })().catch((e) => { console.error("near-connect failed", e); setError(`Wallet failed to load: ${e instanceof Error ? e.message : String(e)}`); });
    const onRej = (ev: PromiseRejectionEvent) => {
      const msg = String(ev.reason?.message ?? ev.reason ?? "");
      if (/wallet|meteor|popup|near|sign/i.test(msg)) setError(msg.slice(0, 300));
    };
    window.addEventListener("unhandledrejection", onRej);
    return () => { cancelled = true; clearTimeout(slow); window.removeEventListener("unhandledrejection", onRej); cleanup?.(); };
  }, []);

  const signIn = useCallback(() => {
    if (!connector) { setError("The wallet is still loading, or failed to start. Reload the page and try again."); return; }
    connector.connect()
      .then(async (w) => { setWallet(w); setAccountId((await w.getAccounts())[0]?.accountId ?? null); })
      .catch((e) => { const m = e instanceof Error ? e.message : String(e); if (!/user (rejected|closed|cancel)|closed|cancel/i.test(m)) setError(`Sign-in failed: ${m}`); });
  }, [connector]);
  const signOut = useCallback(async () => {
    if (connector && wallet) await connector.disconnect(wallet);
    setWallet(undefined); setAccountId(null);
  }, [connector, wallet]);

  const call = useCallback<Ctx["call"]>(async (c) => {
    if (!wallet) throw new Error("Wallet is not connected");
    const build = (x: CallArgs) => ({
      receiverId: x.receiverId,
      actions: [x as Act, ...(x.then ?? [])].map((a) => ({
        type: "FunctionCall" as const,
        params: { methodName: a.methodName, args: (a.args ?? {}) as Record<string, unknown>, gas: a.gas ?? String(100n * 10n ** 12n), deposit: a.deposit ?? "0" },
      })),
    });
    const failure = (o: { status?: unknown } | undefined | void) => {
      const st = o && (o as { status?: { Failure?: unknown } | string }).status;
      return typeof st === "object" && st && "Failure" in st ? JSON.stringify(st.Failure) : undefined;
    };
    if (Array.isArray(c)) {
      const outs = await wallet.signAndSendTransactions({ transactions: c.map(build) });
      if (!outs) return {};
      const list = outs as unknown as { status?: unknown; transaction?: { hash?: string } }[];
      const failed = list.map(failure).find(Boolean);
      return { hash: list[list.length - 1]?.transaction?.hash, failure: failed };
    }
    const out = await wallet.signAndSendTransaction(build(c));
    if (!out) return {};
    return { hash: out.transaction?.hash, failure: failure(out) };
  }, [wallet]);

  const value = useMemo(() => ({ ready: !!connector, error, clearError, accountId, signIn, signOut, call }), [connector, error, clearError, accountId, signIn, signOut, call]);
  return (
    <WalletCtx.Provider value={value}>
      {children}
      {error && (
        <div role="alert" style={{ position: "fixed", left: 12, right: 12, bottom: 12, zIndex: 100000, maxWidth: 560, margin: "0 auto", padding: "12px 40px 12px 14px", background: "#3a1214", color: "#ffd9d9", border: "1px solid #a33", borderRadius: 10, fontSize: 14 }}>
          {error}
          <button onClick={clearError} aria-label="Dismiss" style={{ position: "absolute", right: 8, top: 6, background: "none", border: 0, color: "inherit", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
      )}
    </WalletCtx.Provider>
  );
}
