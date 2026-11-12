"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { rpc, view } from "./near";

/** Polling contract view. `refetch` reloads now; an error keeps the last good data. */
export function useView<T>(contractId: string | undefined, method: string, args: object | undefined, opts: { enabled?: boolean; interval?: number } = {}) {
  const { enabled = true, interval } = opts;
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(false);
  const key = `${contractId}:${method}:${JSON.stringify(args)}`;
  const latest = useRef(key); latest.current = key;
  const run = useCallback(async () => {
    if (!enabled || !contractId || args === undefined) return;
    setLoading(true);
    try {
      const r = await view<T>(contractId, method, args);
      if (latest.current === key) { setData(r); setError(undefined); }
    } catch (e) { if (latest.current === key) setError(e as Error); }
    finally { if (latest.current === key) setLoading(false); }
  }, [key, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setData(undefined); }, [key]);
  useEffect(() => {
    run();
    if (!interval || !enabled) return;
    const t = setInterval(() => { if (!document.hidden) run(); }, Math.max(interval, 4000));
    return () => clearInterval(t);
  }, [run, interval, enabled]);
  return { data, error, loading, refetch: run };
}

/** One shared block-height poller for every component that asks, paused while the tab is hidden. */
const heightSubs = new Set<(h: bigint) => void>();
let heightNow: bigint | undefined;
let heightTimer: ReturnType<typeof setInterval> | undefined;
async function pollHeight() {
  if (document.hidden) return;
  try {
    const r = await rpc<{ header: { height: number } }>("block", { finality: "optimistic" });
    heightNow = BigInt(r.header.height);
    heightSubs.forEach((f) => f(heightNow as bigint));
  } catch { /* keep the last height */ }
}

/** Latest block height, for "wait for the seed block". */
export function useBlockHeight(interval = 3000) {
  const [h, setH] = useState<bigint | undefined>(heightNow);
  useEffect(() => {
    heightSubs.add(setH);
    if (heightSubs.size === 1) { pollHeight(); heightTimer = setInterval(pollHeight, interval); }
    else if (heightNow !== undefined) setH(heightNow);
    return () => { heightSubs.delete(setH); if (!heightSubs.size && heightTimer) { clearInterval(heightTimer); heightTimer = undefined; } };
  }, [interval]);
  return h;
}
