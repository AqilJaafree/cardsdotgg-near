"use client";
/** NEAR wallets sign for the network they were set up with (testnet here), so there is no chain switch to prompt for. */
export function NetworkGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
