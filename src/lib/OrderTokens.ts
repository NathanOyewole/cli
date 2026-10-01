import { DatapiClient, type Token } from "../clients/DatapiClient.ts";
import { NumberConverter } from "./NumberConverter.ts";
import { Swap } from "./Swap.ts";

export type TokenRef = {
  id: string;
  symbol: string | null;
  decimals: number | null;
};

export function toTokenRef(token: Token): TokenRef {
  return { id: token.id, symbol: token.symbol, decimals: token.decimals };
}

export class OrderTokens {
  #tokens: Map<string, Token>;

  private constructor(tokens: Token[]) {
    this.#tokens = new Map(tokens.map((t) => [t.id, t]));
  }

  public static async load(mints: string[]): Promise<OrderTokens> {
    const unique = [...new Set(mints.filter(Boolean))];
    return new OrderTokens(await DatapiClient.getTokensByMints(unique));
  }

  public ref(mint: string): TokenRef {
    const token = this.#tokens.get(mint);
    return token
      ? toTokenRef(token)
      : { id: mint, symbol: null, decimals: null };
  }

  public symbol(mint: string): string {
    return this.#tokens.get(mint)?.symbol ?? `${mint.slice(0, 4)}...`;
  }

  // Falls back to the raw on-chain amount when token metadata is unavailable.
  public uiAmount(
    mint: string,
    rawAmount: string | null | undefined
  ): string | null {
    if (rawAmount === null || rawAmount === undefined || rawAmount === "") {
      return null;
    }
    const token = this.#tokens.get(mint);
    if (!token) {
      return rawAmount;
    }
    return NumberConverter.fromChainAmount(
      rawAmount,
      token.decimals,
      Swap.getScaledUiMultiplier(token)
    );
  }
}
