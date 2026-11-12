"use client";
import { WalletProvider } from "@/lib/wallet";

/** NEAR wallet sign-in (MyNearWallet, HOT). Every contract call is a wallet-signed transaction. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <WalletProvider>{children}</WalletProvider>;
}
