/**
 * Session keys: a restricted key on the player's own account that lets the app sign game moves itself, so a turn needs
 * no wallet pop-up. Pure and framework-free (no React, no browser storage) so the keeper's end-to-end test can use the
 * same code as the app.
 *
 * The key is a NEAR function-call access key. The chain itself limits what it can do:
 *  - only the game contract (`contractId`),
 *  - only the listed methods (game moves, forfeit, claim a timeout),
 *  - no attached deposit, so it can never move tokens or NEAR,
 *  - a gas allowance that caps how much it can ever spend on fees.
 * The player can delete it at any time. The wallet approves adding it once.
 */

/** The only methods a session key may call. Everything else still goes through the wallet. */
export const SESSION_METHODS = ["play_turn", "play", "forfeit", "claim_timeout"];
/** Lifetime gas budget of the key in yoctoNEAR (0.25 NEAR, roughly a thousand turns: a whole match used about 0.002). It only
 * caps fees; nothing is transferred to the key. */
export const SESSION_ALLOWANCE = "250000000000000000000000";
/** Gas attached to a session-signed call. The allowance is charged for attached gas, so keep it modest. */
export const SESSION_GAS = 100n * 10n ** 12n;

export type SessionKey = { privateKey: string; publicKey: string };

export async function newSessionKey(): Promise<SessionKey> {
  const { KeyPair } = await import("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  return { privateKey: kp.toString(), publicKey: kp.getPublicKey().toString() };
}

/** The wallet action that adds the session key to the player's account. */
export const addKeyAction = (publicKey: string, contractId: string) => ({
  type: "AddKey" as const,
  params: { publicKey, accessKey: { permission: { receiverId: contractId, allowance: SESSION_ALLOWANCE, methodNames: SESSION_METHODS } } },
});
export const deleteKeyAction = (publicKey: string) => ({ type: "DeleteKey" as const, params: { publicKey } });

/** Is this key still on the account with the right limits? Reads `view_access_key`; never throws. */
export async function keyIsLive(rpcUrls: string[], accountId: string, publicKey: string, contractId: string): Promise<boolean> {
  for (const url of rpcUrls) {
    try {
      const res = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "k", method: "query", params: { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey } }),
      });
      const json = await res.json();
      if (json.error || json.result?.error) return false;
      const fc = json.result?.permission?.FunctionCall;
      return !!fc && fc.receiver_id === contractId && Array.isArray(fc.method_names) && SESSION_METHODS.every((m) => fc.method_names.includes(m));
    } catch { /* try the next endpoint */ }
  }
  return false;
}

/** Signs and sends one game call with the session key. Resolves with the tx hash and any on-chain failure text. */
export async function callWithKey(opts: { rpcUrl: string; accountId: string; privateKey: string; contractId: string; methodName: string; args: object; gas?: bigint }): Promise<{ hash?: string; failure?: string }> {
  const { Account } = await import("near-api-js");
  const acct = new Account(opts.accountId, opts.rpcUrl, opts.privateKey as `ed25519:${string}`);
  const out = await acct.callFunctionRaw({ contractId: opts.contractId, methodName: opts.methodName, args: opts.args as Record<string, unknown>, gas: opts.gas ?? SESSION_GAS, deposit: 0n });
  const o = out as unknown as { status?: unknown; transaction?: { hash?: string } };
  const st = o.status as { Failure?: unknown } | string | undefined;
  return { hash: o.transaction?.hash, failure: typeof st === "object" && st && "Failure" in st ? JSON.stringify(st.Failure) : undefined };
}

/** Errors that mean the key itself is unusable (not that the move was illegal): fall back to the wallet. */
export const keyProblem = (message: string) => /AccessKeyNotFound|access key|DepositWithFunctionCall|MethodNameMismatch|ReceiverMismatch|NotEnoughAllowance|InvalidSignature|InvalidNonce/i.test(message);
