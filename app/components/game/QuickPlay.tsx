"use client";
import { useWallet } from "@/lib/wallet";

/**
 * Quick play: your game moves send with no pop-up. It normally starts with matchmaking (same approval) and ends with the
 * result screen; this strip only offers it when a duel is already running without it, and shows when it is on. The key added to your account can
 * only call this game's move methods (no token transfers, no deposits) and you can turn it off at any time.
 */
export function QuickPlay({ offer = true }: { offer?: boolean }) {
  const { session, accountId } = useWallet();
  if (!accountId) return null;
  if (session.active) {
    return (
      <p className="quick-on" role="status">⚡ Quick play is on: your moves send with no pop-ups. <button onClick={session.disable} disabled={session.busy}>Turn off</button></p>
    );
  }
  if (!offer) return null; // matchmaking already turns it on with its own approval
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
