"use client";
import { useState } from "react";
import { explorerTx } from "@/lib/chain";
import { useWallet, type CallArgs } from "@/lib/wallet";

/** All writes go through this: wallet prompt -> pending -> explorer link, with contract panic messages. */
export function TxButton({
  label, request, disabled, onConfirmed, onFailed, tone, withSession, verify,
}: { tone?: "soft"; label: string; request: CallArgs | CallArgs[]; disabled?: boolean; onConfirmed?: (hash?: string) => void; onFailed?: () => void;
  /** With `withSession`: checks whether the call already went through, before a failed bundled approval is retried. */ verify?: () => Promise<boolean>;
  /** Matchmaking buttons: also turns on quick play (a session key) in this same wallet approval. */ withSession?: boolean }) {
  const { call, accountId, session } = useWallet();
  const [state, setState] = useState<"idle" | "wallet" | "done" | "failed">("idle");
  const [hash, setHash] = useState<string>();
  const [msg, setMsg] = useState<string>();

  async function run() {
    setState("wallet"); setMsg(undefined); setHash(undefined);
    try {
      const r = withSession && !Array.isArray(request) ? await session.startWith(request, verify) : await call(request);
      setHash(r.hash);
      if (r.failure) { setState("failed"); setMsg(readable(r.failure)); onFailed?.(); return; }
      setState("done");
      onConfirmed?.(r.hash);
    } catch (e) {
      setState("failed");
      setMsg(readable((e as Error)?.message ?? String(e)));
      onFailed?.();
    }
  }

  return (
    <div className={`tx ${tone ?? ""}`}>
      <button disabled={disabled || !accountId || state === "wallet"} onClick={run}>
        {state === "wallet" ? "Confirm in wallet…" : label}
      </button>
      {hash && <a href={explorerTx(hash)} target="_blank" rel="noreferrer">{state === "done" ? "✓ Confirmed" : state === "failed" ? "✗ Failed" : "Submitted"} · view on explorer</a>}
      {msg && <p className="err">{msg}</p>}
    </div>
  );
}

/** Contract panics arrive wrapped in JSON; pull out the human part. */
export function readable(s: string): string {
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  const text = m ? m[1] : s;
  // Plain-language versions of the contract's refusals that a player can actually hit.
  const friendly: [RegExp, string][] = [
    [/^not open\b/, "That lobby was just taken or closed. Looking for another one."],
    [/^expired\b/, "That lobby timed out. Looking for another one."],
    [/^own challenge\b/, "That lobby is yours. Wait for another player to join it."],
    [/^not your turn\b/, "It isn’t your turn yet."],
  ];
  for (const [re, msg] of friendly) if (re.test(text)) return msg;
  return text.slice(0, 240);
}
