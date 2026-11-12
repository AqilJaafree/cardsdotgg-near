// NEAR testnet is where the game lives. Real Rhea data is read from mainnet by the keeper and written into shared/*.json.
export const NETWORK_ID = "testnet" as const;
export const RPC_URLS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.near.org"];
export const EXPLORER = "https://testnet.nearblocks.io";
export const FAUCET = "https://near-faucet.io/";

export const explorerTx = (hash: string) => `${EXPLORER}/txns/${hash}`;
export const explorerAddr = (a: string) => `${EXPLORER}/address/${a}`;
