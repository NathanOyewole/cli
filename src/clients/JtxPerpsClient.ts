import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Signature,
} from "@solana/kit";
import { HTTPError } from "ky";

import { findOpenedIntent } from "../lib/JtxOrder.ts";
import { Rpc } from "../lib/Rpc.ts";
import { ClientConfig } from "./ClientConfig.ts";

export type JtxSide = "Bid" | "Ask";

type OrderLimits = {
  minOrderQty: number;
  minOrderNotional: number;
  maxOpenOrderQty: number;
  maxCloseOrderQty: number;
  maxOpenOrderNotional: number;
  maxCloseOrderNotional: number;
};

export type JtxMarket = {
  symbol: string;
  pubkey: string;
  markPrice: number;
  indexPrice: number;
  bestBid: number;
  bestAsk: number;
  initialMarginRatioBps: number;
  maintenanceMarginRatioBps: number;
  maxLeverage?: number;
  takerFeeBps: number;
  makerFeeBps: number;
  orderLimitConfig: {
    limit: OrderLimits;
    market: OrderLimits;
    postOnly: OrderLimits;
  };
  limitOrderDeviationBps: number;
  openInterest: number;
  openInterestBase: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  priceChangePercent24h: number;
  tickSize: number;
  stepSize: number;
};

export type JtxHealth = {
  status: "healthy" | "degraded" | "unhealthy";
  trading_available: boolean;
  market_health: {
    symbol: string;
    status: string;
    depth_status: "normal" | "thin" | "empty" | "one_sided" | "unavailable";
  }[];
};

export type JtxFundingRate = {
  symbol: string;
  rateBps1h: number;
  fundingIntervalSeconds: number;
  nextFundingCollectionTime: number;
};

export type JtxOrderbook = {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  timestamp: number;
};

export type JtxTradingAccount = {
  pubkey: string;
  subaccountId: number;
  isolated: boolean | null;
  market: string | null;
  data: {
    freeBalance: string;
    accountValue: string;
    totalMaintenanceMargin: string;
    crossAccountLeverage: string;
  };
};

export type JtxPosition = {
  symbol: string;
  side: JtxSide;
  size: string;
  avgEntryPrice: string;
  markPrice: string;
  margin: string;
  collateral?: string | null;
  liquidationPrice?: string | null;
  unrealizedPnl?: string;
  unrealizedPnlPercent?: string;
  fundingAccrued: string;
};

export type JtxOpenOrder = {
  symbol: string;
  orderId: string;
  clientOrderId?: string;
  side: JtxSide;
  price: string;
  initialSize: string;
  remainingSize: string;
  reduceOnly: boolean;
  collateral?: string | null;
  status: string;
};

export type JtxOrderHistory = {
  orderId: string;
  clientOrderId: string | null;
  symbol: string;
  side: JtxSide;
  reduceOnly: boolean;
  price: string;
  originalSize: string;
  filledSize: string;
  realizedPnl: string | null;
  status: string;
  createdAt: number;
  orderType: string;
  originTxId?: string | null;
};

export type JtxTrade = {
  symbol: string;
  side: JtxSide;
  price: string;
  size: string;
  txid: string;
  time: number;
  fee: string;
  realizedPnl: string | null;
};

export type JtxFundingPayment = {
  symbol: string;
  funding: number;
  side: JtxSide | null;
  size: string | null;
  fundingRate: string | null;
  signature: string;
  timestamp: number;
};

export type JtxIntentResponse = {
  transaction: string;
  lastValidBlockHeight: number;
};

export type JtxExecuteResponse = {
  status: "Success" | "Failed";
  code: number;
  error?: string;
  signature?: string;
};

export type JtxIntentStatus = {
  intentId: string;
  status: "executed";
  user: string;
  subaccountId: number;
  numIntents: number;
  jupnetTx: string | null;
  executedAt: number;
};

export type JtxTimeInForce =
  | "ImmediateOrCancel"
  | "GoodTilCanceled"
  | "FillOrKill";

const PROGRAM = address("jtxQHH3ysuWRETjaynai3jowPztq2LBJApVFcEv4Wmg");
export class JtxPerpsClient {
  // Accounts opened from Solana through cross-chain intents use this subaccount.
  public static readonly SOLANA_SUBACCOUNT_ID = 255;

  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://gum-api.jup.net/fe/mainnet-beta/perps",
    hooks: {
      beforeError: [
        async (error: HTTPError) => {
          const body = (await error.response
            .clone()
            .json()
            .catch(() => undefined)) as { error?: string } | undefined;
          if (body?.error) {
            error.message = body.error;
          }
          return error;
        },
      ],
    },
  });

  // The cross-margin account PDA; its /positions and /orders cover the
  // wallet's per-market isolated accounts too.
  public static async getTradingAccountPubkey(
    walletAddress: string
  ): Promise<string> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: PROGRAM,
      seeds: [
        "cross_margin",
        getAddressEncoder().encode(address(walletAddress)),
        Uint8Array.of(this.SOLANA_SUBACCOUNT_ID),
      ],
    });
    return pda;
  }

  public static async getHealth(): Promise<JtxHealth> {
    return this.#ky.get("health").json();
  }

  public static async getMarkets(): Promise<JtxMarket[]> {
    return this.#ky.get("markets").json();
  }

  public static async getFundingRate(symbol: string): Promise<JtxFundingRate> {
    return this.#ky.get(`fundingRate/${symbol}`).json();
  }

  public static async getOrderbook(
    symbol: string,
    depth: number
  ): Promise<JtxOrderbook> {
    return this.#ky
      .get(`orderbook/${symbol}`, { searchParams: { depth } })
      .json();
  }

  public static async getTradingAccounts(
    walletAddress: string
  ): Promise<{ exists: boolean; accounts: JtxTradingAccount[] }> {
    return this.#ky
      .get("tradingAccount", { headers: { "X-PUBKEY": walletAddress } })
      .json();
  }

  public static async getPositions(account: string): Promise<JtxPosition[]> {
    return this.#accountRead(`tradingAccount/${account}/positions`);
  }

  public static async getOpenOrders(account: string): Promise<JtxOpenOrder[]> {
    return this.#accountRead(`tradingAccount/${account}/orders`);
  }

  public static async getOrderHistory(
    account: string,
    params: { symbol?: string; limit: number; startTime?: number }
  ): Promise<JtxOrderHistory[]> {
    const res = await this.#accountRead<{ orders: JtxOrderHistory[] }>(
      `tradingAccount/${account}/orderHistory`,
      { offset: 0, ...params }
    );
    return Array.isArray(res) ? [] : res.orders;
  }

  public static async getTrades(
    account: string,
    symbol?: string
  ): Promise<JtxTrade[]> {
    return this.#accountRead(
      `tradingAccount/${account}/trades`,
      symbol ? { symbol } : {}
    );
  }

  public static async getFundingHistory(
    account: string,
    limit: number
  ): Promise<JtxFundingPayment[]> {
    const res = await this.#accountRead<{ entries: JtxFundingPayment[] }>(
      `tradingAccount/${account}/funding`,
      { limit, offset: 0 }
    );
    return Array.isArray(res) ? [] : res.entries;
  }

  public static async postCreateOrder(req: {
    user: string;
    symbol: string;
    side: JtxSide;
    orderType: "market" | "limit";
    price: number;
    quantity: number;
    collateralAmount: number;
    reduceOnly: boolean;
    timeInForce: JtxTimeInForce;
    clientOrderId: string;
  }): Promise<JtxIntentResponse> {
    return this.#ky
      .post("crosschain/intent/order/create", { json: req })
      .json();
  }

  public static async postCancelOrder(req: {
    user: string;
    symbol: string;
    clientOrderId: string;
    orderId?: string;
  }): Promise<JtxIntentResponse> {
    return this.#ky
      .post("crosschain/intent/order/cancel", { json: req })
      .json();
  }

  public static async postCollateral(
    kind: "deposit" | "withdraw",
    req: { user: string; symbol: string; amount: number }
  ): Promise<JtxIntentResponse> {
    return this.#ky.post(`crosschain/intent/${kind}`, { json: req }).json();
  }

  public static async postExecute(
    signedTransaction: string
  ): Promise<JtxExecuteResponse> {
    return this.#ky
      .post("crosschain/intent/execute", {
        json: { signedTransaction },
        timeout: 60_000,
      })
      .json();
  }

  // Null until the intent executes: the API answers 404 while it is pending.
  public static async getIntentStatus(
    intentId: string
  ): Promise<JtxIntentStatus | null> {
    try {
      return await this.#ky.get(`crosschain/intent/${intentId}`).json();
    } catch (err) {
      if (err instanceof HTTPError && err.response.status === 404) {
        return null;
      }
      throw err;
    }
  }

  // The source transaction's on-chain error and the intent it opened, or null
  // while it has not landed.
  public static async getOpenedIntent(signature: string): Promise<{
    err: unknown;
    intent: { intentId: string; user: string } | null;
  } | null> {
    const tx = await createSolanaRpc(Rpc.url)
      .getTransaction(signature as Signature, {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 0,
      })
      .send();
    if (!tx?.meta) {
      return null;
    }
    const keys = [
      ...tx.transaction.message.accountKeys,
      ...(tx.meta.loadedAddresses?.writable ?? []),
      ...(tx.meta.loadedAddresses?.readonly ?? []),
    ];
    return {
      err: tx.meta.err,
      intent: findOpenedIntent(
        keys,
        (tx.meta.innerInstructions ?? []).flatMap((group) => group.instructions)
      ),
    };
  }

  // A wallet that never traded has no trading account; the API answers 400.
  static async #accountRead<T>(
    path: string,
    searchParams: Record<string, string | number> = {}
  ): Promise<T | never[]> {
    try {
      return await this.#ky.get(path, { searchParams }).json<T>();
    } catch (err) {
      if (
        err instanceof HTTPError &&
        /trading account not found/i.test(err.message)
      ) {
        return [];
      }
      throw err;
    }
  }
}
