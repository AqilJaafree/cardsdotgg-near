"use client";
import { useEffect } from "react";
import { useWallet } from "@/lib/wallet";

/** Game settings: turn quick play (the session key) on or off, and sound. Opens as a sheet over the screen. */
export function SettingsSheet({ onClose, sound, inDuel = false, onForfeit, hideQuickPlay = false }: { onClose: () => void; sound?: { on: boolean; toggle: () => void }; inDuel?: boolean; onForfeit?: () => void; hideQuickPlay?: boolean }) {
  const { session, accountId } = useWallet();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="settings-sheet" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <header><h2>Settings</h2><button className="settings-x" onClick={onClose} aria-label="Close settings">✕</button></header>

        {!hideQuickPlay && <div className="settings-row settings-quick">
          <div className="settings-text">
            <b>⚡ Quick play <span className={`settings-badge ${session.active ? "on" : ""}`}>{session.active ? "ON" : "OFF"}</span></b>
            <small>
              {session.active
                ? "Your moves and forfeit send with no wallet pop-ups. The key can only play this game, never move your coins."
                : "Every move asks your wallet. Turn it on once and moves send with no pop-ups."}
              {session.active && inDuel ? " If you turn it off during a fight, every move will ask your wallet." : ""}
            </small>
          </div>
          {session.active
            ? <button className="settings-btn" onClick={session.disable} disabled={session.busy || !accountId}>{session.busy ? "Waiting for your wallet…" : "Turn off quick play"}</button>
            : <button className="settings-btn on" onClick={session.enable} disabled={session.busy || !accountId}>{session.busy ? "Waiting for your wallet…" : "Turn on quick play"}</button>}
          {session.error && <small className="settings-err" role="alert">{session.error}</small>}
        </div>}

        {sound && (
          <div className="settings-row">
            <div className="settings-text"><b>🔊 Sound <span className={`settings-badge ${sound.on ? "on" : ""}`}>{sound.on ? "ON" : "OFF"}</span></b></div>
            <button className="settings-btn" onClick={sound.toggle}>{sound.on ? "Mute" : "Unmute"}</button>
          </div>
        )}
        {onForfeit && (
          <div className="settings-row settings-danger">
            <div className="settings-text"><b>🏳 Forfeit match</b><small>Quitting counts as a loss. Your opponent wins and the stake settles.</small></div>
            <button className="settings-btn danger" onClick={onForfeit}>Forfeit match</button>
          </div>
        )}
        <button className="settings-btn done settings-close" onClick={onClose}>Done</button>
      </section>
    </div>
  );
}
