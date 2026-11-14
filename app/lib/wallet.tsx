"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import { NETWORK_ID, RPC_URLS } from "./chain";
import { SESSION_GAS, SESSION_METHODS, addKeyAction, callWithKey, deleteKeyAction, keyIsLive, keyProblem, newSessionKey, type SessionKey } from "./session-core";
import { A } from "./contracts";

export type Act = { methodName: string; args?: object; deposit?: string; gas?: string };
/** One transaction to one contract. `then` adds more actions to the same transaction: one signature, all or nothing. */
export type CallArgs = Act & { receiverId: string; then?: Act[] };
type Ctx = {
  ready: boolean; error: string | null; clearError: () => void; accountId: string | null; signIn: () => void; signOut: () => Promise<void>;
  /** Signs and sends one transaction, or several (an array) behind a single wallet approval. Returns the last
   *  transaction hash, or nothing when the wallet redirects away. */
  call: (c: CallArgs | CallArgs[]) => Promise<{ hash?: string; failure?: string }>;
  /** Quick play: a restricted key (game moves only, no deposits) that lets the app sign game moves with no pop-up. */
  session: {
    active: boolean; busy: boolean; error: string | null; enable: () => Promise<void>; disable: () => Promise<void>;
    /** Matchmaking: sends `c` and adds the session key in the SAME wallet approval. With a session already on, it is just `call`. */
    startWith: (c: CallArgs) => Promise<{ hash?: string; failure?: string }>;
    /** End of a match: sends `c` (e.g. collect rewards) and removes the session key in the SAME wallet approval. */
    endWith: (c: CallArgs | null) => Promise<{ hash?: string; failure?: string }>;
  };
};
const WalletCtx = createContext<Ctx | null>(null);

/** One transaction in the shape the wallet wants: every action of a CallArgs is a function call. */
const buildTx = (x: CallArgs) => ({
  receiverId: x.receiverId,
  actions: [x as Act, ...(x.then ?? [])].map((a) => ({
    type: "FunctionCall" as const,
    params: { methodName: a.methodName, args: (a.args ?? {}) as Record<string, unknown>, gas: a.gas ?? String(100n * 10n ** 12n), deposit: a.deposit ?? "0" },
  })),
});
const failureOf = (o: { status?: unknown } | undefined | void) => {
  const st = o && (o as { status?: { Failure?: unknown } | string }).status;
  return typeof st === "object" && st && "Failure" in st ? JSON.stringify(st.Failure) : undefined;
};
type Outcome = { status?: unknown; transaction?: { hash?: string } };
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

  // ---- quick play (session key) ----
  const [sess, setSess] = useState<SessionKey | null>(null);
  const [sessBusy, setSessBusy] = useState(false);
  const [sessError, setSessError] = useState<string | null>(null);
  const bundleBroken = useRef(false); // set once a wallet fails on a bundled add/remove-key approval, so we stop bundling
  const sessStore = (id: string) => `cardsdotgg.session.${A.game}.${id}`;
  const readStored = (id: string): SessionKey | null => { try { const v = JSON.parse(localStorage.getItem(sessStore(id)) ?? "null"); return v?.privateKey && v?.publicKey ? v : null; } catch { return null; } };
  const writeStored = (id: string, v: SessionKey | null) => { try { if (v) localStorage.setItem(sessStore(id), JSON.stringify(v)); else localStorage.removeItem(sessStore(id)); } catch { /* storage may be blocked */ } };
  // Pick up a key saved earlier (also right after a wallet redirect), but only if it is still on the account.
  useEffect(() => {
    setSess(null);
    if (!accountId) return;
    const stored = readStored(accountId);
    if (!stored) return;
    let live = true;
    keyIsLive(RPC_URLS, accountId, stored.publicKey, A.game).then((ok) => { if (!live) return; if (ok) setSess(stored); else writeStored(accountId, null); });
    return () => { live = false; };
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const slow = setTimeout(() => setError((cur) => cur ?? "The wallet is taking too long to load. Check your connection or reload the page."), 10000);
    (async () => {
      const { NearConnector } = await import("@hot-labs/near-connect");
      const c = new NearConnector({
        network: NETWORK_ID,
        providers: { mainnet: ["https://free.rpc.fastnear.com"], testnet: RPC_URLS }, // a second endpoint to fall back on when one rate-limits
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

  const enableSession = useCallback(async () => {
    if (!wallet || !accountId) { setSessError("Connect your wallet first."); return; }
    setSessBusy(true); setSessError(null);
    try {
      const key = await newSessionKey();
      writeStored(accountId, key); // saved first: a redirecting wallet reloads the page before this function returns
      const out = await wallet.signAndSendTransaction({ receiverId: accountId, actions: [addKeyAction(key.publicKey, A.game)] });
      const st = out && (out as { status?: { Failure?: unknown } | string }).status;
      if (typeof st === "object" && st && "Failure" in st) throw new Error(JSON.stringify(st.Failure));
      let live = false;
      for (let i = 0; i < 8 && !live; i++) { live = await keyIsLive(RPC_URLS, accountId, key.publicKey, A.game); if (!live) await new Promise((r) => setTimeout(r, 700)); }
      if (!live) throw new Error("The key was not added to your account.");
      setSess(key);
    } catch (e) {
      writeStored(accountId, null);
      const m = e instanceof Error ? e.message : String(e);
      if (!/user (rejected|closed|cancel)|closed|cancel/i.test(m)) setSessError(m.slice(0, 200));
    } finally { setSessBusy(false); }
  }, [wallet, accountId]); // eslint-disable-line react-hooks/exhaustive-deps
  const disableSession = useCallback(async () => {
    const key = sess; if (!key || !accountId) return;
    setSessBusy(true); setSessError(null);
    setSess(null); writeStored(accountId, null); // the app stops using it at once
    try { await wallet?.signAndSendTransaction({ receiverId: accountId, actions: [deleteKeyAction(key.publicKey)] }); } // and the wallet removes it from the account
    catch { /* declined: the key stays on the account but this browser has forgotten it */ }
    finally { setSessBusy(false); }
  }, [sess, accountId, wallet]); // eslint-disable-line react-hooks/exhaustive-deps

  const call = useCallback<Ctx["call"]>(async (c) => {
    if (!wallet) throw new Error("Wallet is not connected");
    // Quick play: a single game call goes out signed by the session key, with no wallet pop-up.
    if (sess && accountId && !Array.isArray(c) && c.receiverId === A.game && SESSION_METHODS.includes(c.methodName) && !c.then?.length && (!c.deposit || c.deposit === "0")) {
      let last = "";
      for (const rpcUrl of RPC_URLS) {
        try {
          return await callWithKey({ rpcUrl, accountId, privateKey: sess.privateKey, contractId: A.game, methodName: c.methodName, args: c.args ?? {}, gas: c.gas ? BigInt(c.gas) : SESSION_GAS });
        } catch (e) {
          last = e instanceof Error ? e.message : String(e);
          if (keyProblem(last)) { setSess(null); writeStored(accountId, null); last = ""; break; } // key revoked or used up: fall back to the wallet
        }
      }
      if (last) return { failure: last.slice(0, 300) };
    }
    if (Array.isArray(c)) {
      const outs = await wallet.signAndSendTransactions({ transactions: c.map(buildTx) });
      if (!outs) return {};
      const list = outs as unknown as Outcome[];
      return { hash: list[list.length - 1]?.transaction?.hash, failure: list.map(failureOf).find(Boolean) };
    }
    const out = await wallet.signAndSendTransaction(buildTx(c));
    if (!out) return {};
    return { hash: out.transaction?.hash, failure: failureOf(out) };
  }, [wallet, sess, accountId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startWith = useCallback<Ctx["session"]["startWith"]>(async (c) => {
    if (!wallet || !accountId) throw new Error("Wallet is not connected");
    if (sess) return call(c);
    if (bundleBroken.current) return call(c); // this wallet could not read the bundled add-key approval earlier
    setSessBusy(true); setSessError(null);
    const key = await newSessionKey();
    writeStored(accountId, key); // saved first: a redirecting wallet reloads the page before this returns
    let outs: Outcome[] | undefined;
    try {
      outs = (await wallet.signAndSendTransactions({ transactions: [{ receiverId: accountId, actions: [addKeyAction(key.publicKey, A.game)] }, buildTx(c)] })) as unknown as Outcome[] | undefined;
    } catch (e) {
      writeStored(accountId, null); setSessBusy(false);
      const m = e instanceof Error ? e.message : String(e);
      if (/user (rejected|closed|cancel)|closed|cancel|reject|denied/i.test(m)) throw e; // the player said no: stop here
      // The wallet could not handle the bundled approval. Quick play is optional, so play on without it.
      bundleBroken.current = true;
      setSessError("Quick play couldn’t start with this wallet, so moves will ask for approval.");
      return call(c);
    }
    if (!outs) { setSessBusy(false); return {}; } // redirected away; the key is picked up when the page comes back
    const result = { hash: outs[outs.length - 1]?.transaction?.hash, failure: outs.map(failureOf).find(Boolean) };
    let live = false;
    for (let i = 0; i < 8 && !live; i++) { live = await keyIsLive(RPC_URLS, accountId, key.publicKey, A.game); if (!live) await new Promise((r) => setTimeout(r, 700)); }
    if (live) setSess(key); else { writeStored(accountId, null); setSessError("Quick play couldn’t start, so moves will ask your wallet."); }
    setSessBusy(false);
    return result;
  }, [wallet, accountId, sess, call]); // eslint-disable-line react-hooks/exhaustive-deps
  const endWith = useCallback<Ctx["session"]["endWith"]>(async (c) => {
    if (!wallet || !accountId) throw new Error("Wallet is not connected");
    if (!sess) return c ? call(c) : {};
    setSessBusy(true); setSessError(null);
    const rejected = (e: unknown) => /user (rejected|closed|cancel)|closed|cancel|reject|denied/i.test(e instanceof Error ? e.message : String(e));
    const forget = () => { setSess(null); writeStored(accountId, null); };
    try {
      // Preferred: one approval that claims and removes the key. Some wallets (Meteor) cannot read the remove-key step.
      if (!bundleBroken.current) {
        try {
          const txs = [...(c ? [buildTx(c)] : []), { receiverId: accountId, actions: [deleteKeyAction(sess.publicKey)] }];
          const outs = (await wallet.signAndSendTransactions({ transactions: txs })) as unknown as Outcome[] | undefined;
          forget();
          if (!outs) return {};
          return { hash: outs[0]?.transaction?.hash, failure: outs.map(failureOf).find(Boolean) };
        } catch (e) {
          if (rejected(e)) throw e; // the player said no: nothing changed, the session keeps running
          bundleBroken.current = true;
        }
      }
      // Fallback: claim on its own first (that is what the player asked for), then try to remove the key separately.
      const result = c ? await call(c) : {};
      if (result.failure) return result;
      try {
        await wallet.signAndSendTransaction({ receiverId: accountId, actions: [deleteKeyAction(sess.publicKey)] });
        forget();
      } catch (e) {
        if (!rejected(e)) setSessError("Rewards claimed. This wallet couldn’t remove the quick-play key, so quick play is still on.");
      }
      return result;
    } finally { setSessBusy(false); }
  }, [wallet, accountId, sess, call]); // eslint-disable-line react-hooks/exhaustive-deps

  const session = useMemo(() => ({ active: !!sess, busy: sessBusy, error: sessError, enable: enableSession, disable: disableSession, startWith, endWith }), [sess, sessBusy, sessError, enableSession, disableSession, startWith, endWith]);
  const value = useMemo(() => ({ ready: !!connector, error, clearError, accountId, signIn, signOut, call, session }), [connector, error, clearError, accountId, signIn, signOut, call, session]);
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
