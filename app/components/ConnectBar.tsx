"use client";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { useWallet } from "@/lib/wallet";

export function ConnectBar() {
  const { accountId, ready, signIn, signOut } = useWallet();
  return (
    <header className="bar">
      <Link href="/" className="brand">{BRAND}</Link>
      <nav>
        <Link href="/deposit">Deposit</Link>
        <Link href="/decks">Decks</Link>
        <Link href="/arena">Arena</Link>
        <Link href="/pool">Pool</Link>
        <Link href="/withdraw">Withdraw</Link>
      </nav>
      {accountId ? <button className="ghost" onClick={() => signOut()}>{accountId}</button> : <button onClick={signIn} disabled={!ready}>Connect wallet</button>}
    </header>
  );
}
