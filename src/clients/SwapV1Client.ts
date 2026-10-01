import type { ApiInstruction } from "../lib/LendTx.ts";
import { ClientConfig } from "./ClientConfig.ts";

export type SwapV1Quote = {
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label: string } }[];
  [key: string]: unknown;
};

// Jupiter Metis swap API. Lend multiply composes the raw swap instruction into
// its own flashloan transaction, which Ultra orders cannot do.
export class SwapV1Client {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/swap/v1`,
    retry: { limit: 2, methods: ["get", "post"] },
  });

  public static async getQuote(req: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
    maxAccounts: number;
    onlyDirectRoutes: boolean;
  }): Promise<SwapV1Quote> {
    return this.#ky
      .get("quote", {
        searchParams: { ...req, restrictIntermediateTokens: true },
      })
      .json();
  }

  public static async postSwapInstructions(req: {
    quoteResponse: SwapV1Quote;
    userPublicKey: string;
  }): Promise<{
    swapInstruction: ApiInstruction;
    addressLookupTableAddresses: string[];
  }> {
    return this.#ky.post("swap-instructions", { json: req }).json();
  }
}
