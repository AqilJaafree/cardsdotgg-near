import { RPC_URLS } from "./chain";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Endpoints that answered 429 recently are skipped until their cool-down ends. */
const coolUntil = new Map<string, number>();
const COOL_MS = 6000;

/** One JSON-RPC POST with failover across RPC_URLS, cool-down on 429, and a few retries with backoff. */
export async function rpc<T = any>(method: string, params: object): Promise<T> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: "cardsdotgg", method, params });
  let last: unknown = new Error("rpc failed");
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = Date.now();
    const urls = RPC_URLS.filter((u) => (coolUntil.get(u) ?? 0) <= now);
    if (!urls.length) { await sleep(Math.min(1500, Math.min(...RPC_URLS.map((u) => (coolUntil.get(u) ?? 0) - now)) + 50)); continue; }
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
        const json = await res.json().catch(() => ({}));
        if (res.status === 429 || json?.error?.code === -429) { coolUntil.set(url, Date.now() + COOL_MS); last = new Error("rate limited, retrying"); continue; }
        if (json.error) throw Object.assign(new Error(json.error.data ?? json.error.message ?? "rpc error"), { final: true });
        return json.result as T;
      } catch (e) { if ((e as { final?: boolean }).final) throw e; last = e; }
    }
    await sleep(400 * 2 ** attempt);
  }
  throw last instanceof Error ? last : new Error("rpc failed");
}

const inflight = new Map<string, Promise<unknown>>();
const recent = new Map<string, { at: number; v: unknown }>();
const FRESH_MS = 2000;

/** Read-only contract call. Identical calls in flight share one request, and results are reused for 2 s. */
export function view<T = unknown>(contractId: string, methodName: string, args: object = {}): Promise<T> {
  const key = `${contractId}:${methodName}:${JSON.stringify(args)}`;
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return Promise.resolve(hit.v as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    const result = await rpc<{ error?: string; result: number[] }>("query", {
      request_type: "call_function", finality: "optimistic", account_id: contractId, method_name: methodName,
      args_base64: btoa(JSON.stringify(args)),
    });
    if (result.error) throw new Error(String(result.error));
    const v = JSON.parse(new TextDecoder().decode(new Uint8Array(result.result))) as T;
    recent.set(key, { at: Date.now(), v });
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const TGAS = (n: number) => String(BigInt(n) * 10n ** 12n);
export const ONE_YOCTO = "1";
