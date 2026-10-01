export type ParityCase =
  | {
      id: string;
      feature: string;
      kind: "read";
      args: string[];
      wallet?: string;
      key?: "generated";
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
    }
  | {
      id: string;
      feature: string;
      kind: "unsupported";
      reason: string;
    };

export const WALLET = "$WALLET";

// Matches simulation failures caused only by an empty wallet: a fee payer
// with no account, or token/lamport balances that are too low.
export const UNFUNDED_SIM_ERROR =
  /AccountNotFound|insufficient (funds|lamports)|InsufficientFundsForRent/i;
