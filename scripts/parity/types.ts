export type ParityCase =
  | {
      id: string;
      feature: string;
      kind: "read";
      args: string[];
      wallet?: string;
      // Run with a freshly generated local key instead of a watch-only one,
      // for reads that need a real wallet signature (signed-message auth).
      signer?: "generated";
      expect?: (json: unknown) => boolean;
    }
  | {
      id: string;
      feature: string;
      kind: "tx";
      args: string[];
      wallet?: string;
    }
  | {
      id: string;
      feature: string;
      kind: "unsupported";
      reason: string;
    };

export const WALLET = "$WALLET";
