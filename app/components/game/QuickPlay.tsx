"use client";
import { useWallet } from "@/lib/wallet";

/**
 * Quick play: your game moves send with no pop-up. It normally starts with matchmaking (same approval); turning it off or on
 * later is in Settings. This strip only offers it when a duel is already running without it. The key added to your account can
 * only call this game's move methods (no token transfers, no deposits) and you can turn it off at any time.
 */
export function QuickPlay() {
  const { session, accountId } = useWallet();
  // Once it is on, the only control is in Settings (the gear). This strip is just the offer.
  if (!accountId || session.active) return null;
  return (
    <div className="quick-box">
      <button className="quick-play" onClick={session.enable} disabled={session.busy}>
        ⚡ {session.busy ? "Waiting for your wallet…" : "Turn on quick play"}
        <small>Approve once, then every move sends with no pop-up. It can only play this game, never move your coins.</small>
      </button>
      {session.error && <p className="quick-err" role="alert">{session.error}</p>}
    </div>
  );
}
