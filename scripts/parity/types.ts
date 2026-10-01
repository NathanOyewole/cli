export type ParityCase =
  | {
      id: string;
      feature: string;
      kind: "read";
      args: string[];
      wallet?: string;
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

// Runs the case with a freshly generated local key instead of a watch-only
// wallet, for flows that need a real message signature (e.g. sign-in).
export const GENERATED_WALLET = "$GENERATED";
