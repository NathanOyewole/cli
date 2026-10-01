import { ClientConfig } from "./ClientConfig.ts";

export type DepositChain = {
  chainId: number;
  chainName: string;
  chainType: string;
  status: { code: number; name: string };
  depositAddress: string;
  tokenAddress: string;
  minDeposit: string;
  feesUsd: number;
};

export type BridgeToken = {
  chainKey: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  isNative: boolean;
};

export type BridgeQuoteResponse = {
  routes: { provider: string; outAmount: string }[];
  failures: { provider: string; reason: string }[];
};

/**
 * The jup.ag web app's own server routes for deposits and bridging. They wrap
 * keyed upstreams (universal deposit, gum, deBridge, Onramper) and answer
 * without auth, so the CLI uses them exactly like the web does.
 */
export class DepositClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://jup.ag/api",
    timeout: 30_000,
  });

  public static async getDepositAddresses(
    destinationAddress: string
  ): Promise<{ chains: DepositChain[] }> {
    return this.#ky
      .get("universal-deposit/deposit-addresses", {
        searchParams: { destinationAddress },
      })
      .json();
  }

  public static async getOnrampUrl(address: string): Promise<{ url: string }> {
    return this.#ky
      .get("onramp/onramper-widget-url", { searchParams: { address } })
      .json();
  }

  public static async getBridgeTokens(
    chainKey: string,
    query?: string
  ): Promise<{ tokens: BridgeToken[] }> {
    return this.#ky
      .get("universal-swap/tokens", {
        searchParams: query ? { chainKey, query } : { chainKey },
      })
      .json();
  }

  public static async getBridgeQuote(params: {
    input: BridgeToken;
    output: BridgeToken;
    rawAmount: string;
  }): Promise<BridgeQuoteResponse> {
    return this.#ky
      .get("universal-swap/quote", {
        searchParams: {
          inputChainKey: params.input.chainKey,
          inputTokenAddress: params.input.address,
          inputIsNative: String(params.input.isNative),
          outputChainKey: params.output.chainKey,
          outputTokenAddress: params.output.address,
          outputIsNative: String(params.output.isNative),
          amount: params.rawAmount,
        },
      })
      .json();
  }
}
