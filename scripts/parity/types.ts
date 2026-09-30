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
