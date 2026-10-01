export type ParityCase =
  | {
      id: string;
      feature: string;
      kind: "read";
      args: string[];
      wallet?: string;
      key?: "generated";
      resolve?: Resolve;
      expect?: (json: unknown) => boolean;
    }
  | {
      id: string;
      feature: string;
      kind: "tx";
      args: string[];
      wallet?: string;
      key?: "generated";
      // Simulation errors that only mean the wallet lacks funds; matching
      // failures get the UNFUNDED verdict instead of FAIL.
      expectSimError?: RegExp;
      resolve?: Resolve;
    }
  | {
      id: string;
      feature: string;
      kind: "unsupported";
      reason: string;
    };

// Looks up live inputs (e.g. a wallet that currently has an open position) at
// run time. Each returned key replaces `$KEY` in args; `WALLET` also sets the
// case wallet.
export type Resolve = () => Promise<Record<string, string>>;

export const WALLET = "$WALLET";

// Matches simulation failures caused only by an empty wallet: a fee payer
// with no account, or token/lamport balances that are too low.
export const UNFUNDED_SIM_ERROR =
  /AccountNotFound|insufficient (funds|lamports)|InsufficientFundsForRent/i;
