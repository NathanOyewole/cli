import { getBase58Decoder } from "@solana/kit";
import { HTTPError, type KyInstance } from "ky";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { Config } from "../lib/Config.ts";
import type { Signer } from "../lib/Signer.ts";
import { ClientConfig } from "./ClientConfig.ts";

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

export type OrderKind = "price" | "dca";

export type Vault = {
  userPubkey: string;
  vaultPubkey: string;
  privyVaultId: string;
};

type PairSupport =
  | { supported: true }
  | { supported: false; error: string; reason?: string };

export type CheckMintsResponse = {
  inputMint: string;
  outputMint: string;
  triggerMint: string | null;
  price: PairSupport;
  dca: PairSupport;
};

export type CraftDepositRequest = {
  inputMint: string;
  outputMint: string;
  userAddress: string;
  amount: string;
  orderType: OrderKind;
  orderSubType?: "single" | "oco" | "otoco";
  jlMint?: string;
};

export type CraftDepositResponse = {
  transaction: string;
  requestId: string;
  receiverAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
};

type CreateOrderBase = {
  depositRequestId: string;
  depositSignedTx: string;
  userPubkey: string;
  inputMint: string;
  inputAmount: string;
  outputMint: string;
};

export type PriceOrderParams = {
  orderType: "single" | "oco" | "otoco";
  triggerMint: string;
  triggerCondition?: "above" | "below";
  triggerPriceUsd?: number;
  trailingBps?: number;
  slippageBps?: number;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
};

export type CreatePriceOrderRequest = CreateOrderBase &
  PriceOrderParams & { expiresAt: number };

export type CreatePriceOrderResponse = {
  id: string;
  txSignature: string;
  depositConfirmed: boolean;
  message?: string;
};

export type DcaOrderParams = {
  orderType: "time_based" | "price_conditional";
  orderCount: number;
  intervalSeconds: number;
  minPriceUsd?: number;
  maxPriceUsd?: number;
  triggerMint?: string;
  jlEnabled?: boolean;
};

export type CreateDcaOrderRequest = CreateOrderBase & DcaOrderParams;

type RawOrderState = string;

export type PriceOrder = {
  id: string;
  orderType: "single" | "oco" | "otoco";
  orderState:
    | "pending"
    | "open"
    | "executing"
    | "filled"
    | "pending_withdraw"
    | "cancelled"
    | "expired"
    | "failed";
  rawState: RawOrderState;
  userPubkey: string;
  inputMint: string;
  remainingInputAmount: string;
  initialInputAmount: string;
  outputMint: string;
  triggerMint: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  triggerCondition?: "above" | "below";
  triggerPriceUsd?: number | null;
  slippageBps?: number | null;
  outputAmount?: string | null;
  fillPercent?: number;
  trailingBps?: number | null;
  tpPriceUsd?: number | null;
  tpSlippageBps?: number | null;
  tpOutputAmount?: string | null;
  slPriceUsd?: number | null;
  slSlippageBps?: number | null;
  slOutputAmount?: string | null;
  events: { type: string; txSignature?: string; state: string }[];
};

export type DcaOrder = {
  id: string;
  userPubkey: string;
  inputMint: string;
  outputMint: string;
  inputAmountInitial: string;
  inputAmountRemaining: string;
  amountPerRound: string;
  outputAmountTotal: string;
  inputAmountUsed: string;
  orderType: "time_based" | "price_conditional";
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  triggerMint: string | null;
  numberOfRounds: number;
  intervalSeconds: number;
  nextFillAt: string | null;
  roundsFilled: number;
  fillPercent: number;
  displayState:
    | "pending"
    | "active"
    | "executing"
    | "cancelling"
    | "pending_withdraw"
    | "completed"
    | "cancelled"
    | "failed";
  jlEnabled?: boolean;
  jlYieldUsd?: number | null;
  createdAt: string;
  updatedAt: string;
};

type OrderHistoryQuery = {
  state: "active" | "past";
  limit: number;
  offset: number;
  mint?: string | undefined;
};

type OrderHistoryResponse<T> = {
  orders: T[];
  pagination: { total: number; limit: number; offset: number };
};

export type PriceOrderPatch = Partial<
  Pick<
    PriceOrderParams,
    | "triggerPriceUsd"
    | "trailingBps"
    | "slippageBps"
    | "tpPriceUsd"
    | "tpSlippageBps"
    | "slPriceUsd"
    | "slSlippageBps"
  >
> & { orderType: PriceOrderParams["orderType"] };

export type CancelOrderResponse = {
  id: string;
  transaction: string;
  requestId: string;
  roundsRemaining?: number;
  refundAmount?: string;
};

export type V1TriggerOrder = {
  orderKey: string;
  inputMint: string;
  outputMint: string;
  makingAmount: string;
  takingAmount: string;
  remainingMakingAmount: string;
  expiredAt: string | null;
  createdAt: string;
  status: "Open" | "Cancelled" | "Completed";
  openTx: string;
  closeTx: string;
};

export type V1DcaOrder = {
  orderKey: string;
  inputMint: string;
  outputMint: string;
  inDeposited: string;
  inUsed: string;
  inWithdrawn: string;
  inAmountPerCycle: string;
  cycleFrequency: string;
  outReceived: string;
  userClosed: boolean;
  createdAt: string;
  openTx: string;
  closeTx: string;
};

type V1Page<T> = { orders: T[]; totalPages: number; totalItems: number };

export type V1List<T> = { orders: T[]; total: number };

// Trigger V1 reports a transaction that failed to land as HTTP 200 with
// status "Failed".
export type V1ExecuteResponse = {
  status: "Success" | "Failed";
  code: number;
  signature?: string | null | undefined;
  error?: string | null | undefined;
};

export class TriggerClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://trigger-api.jup.ag/v2",
    timeout: 60_000,
  });
  static readonly #v1Ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/trigger/v1`,
  });
  static readonly #workerKy = ClientConfig.ky.extend({
    prefixUrl: "https://worker.jup.ag",
  });
  static readonly #AUTH_DIR = join(Config.CONFIG_DIR, "auth");
  static readonly #REFRESH_MARGIN_MS = 10_000;
  static readonly #V1_PAGE_SIZE = 10;

  public static async checkMints(req: {
    orderType: OrderKind;
    inputMint: string;
    outputMint: string;
    triggerMint?: string | undefined;
  }): Promise<CheckMintsResponse> {
    const searchParams: Record<string, string> = {
      orderType: req.orderType,
      inputMint: req.inputMint,
      outputMint: req.outputMint,
    };
    if (req.triggerMint) {
      searchParams.triggerMint = req.triggerMint;
    }
    return this.#ky.get("orders/check-mints", { searchParams }).json();
  }

  public static async ensureVault(signer: Signer): Promise<Vault> {
    return this.#authed(signer, async (ky) => {
      try {
        return await ky.get("vault").json<Vault>();
      } catch (err) {
        if (err instanceof HTTPError && err.response.status === 404) {
          return ky.get("vault/register").json<Vault>();
        }
        throw err;
      }
    });
  }

  public static async craftDeposit(
    signer: Signer,
    req: CraftDepositRequest
  ): Promise<CraftDepositResponse> {
    return this.#authed(signer, (ky) =>
      ky.post("deposit/craft", { json: req }).json()
    );
  }

  public static async createPriceOrder(
    signer: Signer,
    req: CreatePriceOrderRequest
  ): Promise<CreatePriceOrderResponse> {
    return this.#authed(signer, (ky) =>
      ky.post("orders/price", { json: req }).json()
    );
  }

  public static async createDcaOrder(
    signer: Signer,
    req: CreateDcaOrderRequest
  ): Promise<{ id: string; txSignature: string }> {
    return this.#authed(signer, (ky) =>
      ky.post("orders/dca", { json: req }).json()
    );
  }

  public static async getPriceOrders(
    signer: Signer,
    query: OrderHistoryQuery
  ): Promise<OrderHistoryResponse<PriceOrder>> {
    return this.#authed(signer, (ky) =>
      ky
        .get("orders/history", { searchParams: this.#historyParams(query) })
        .json()
    );
  }

  public static async getPriceOrder(
    signer: Signer,
    id: string
  ): Promise<PriceOrder> {
    return this.#authed(signer, (ky) =>
      ky.get(`orders/history/${encodeURIComponent(id)}`).json()
    );
  }

  public static async getDcaOrders(
    signer: Signer,
    query: OrderHistoryQuery
  ): Promise<OrderHistoryResponse<DcaOrder>> {
    return this.#authed(signer, (ky) =>
      ky
        .get("orders/history/dca", {
          searchParams: this.#historyParams(query),
        })
        .json()
    );
  }

  public static async getDcaOrder(
    signer: Signer,
    id: string
  ): Promise<DcaOrder> {
    return this.#authed(signer, (ky) =>
      ky.get(`orders/history/dca/${encodeURIComponent(id)}`).json()
    );
  }

  public static async patchPriceOrder(
    signer: Signer,
    id: string,
    patch: PriceOrderPatch
  ): Promise<{ id: string }> {
    return this.#authed(signer, (ky) =>
      ky.patch(`orders/price/${encodeURIComponent(id)}`, { json: patch }).json()
    );
  }

  public static async cancelOrder(
    signer: Signer,
    kind: OrderKind,
    id: string
  ): Promise<CancelOrderResponse> {
    return this.#authed(signer, (ky) =>
      ky.post(`orders/${kind}/cancel/${encodeURIComponent(id)}`).json()
    );
  }

  public static async confirmCancelOrder(
    signer: Signer,
    kind: OrderKind,
    id: string,
    req: { signedTransaction: string; cancelRequestId: string }
  ): Promise<{ id: string; txSignature: string }> {
    return this.#authed(signer, (ky) =>
      ky
        .post(`orders/${kind}/confirm-cancel/${encodeURIComponent(id)}`, {
          json: req,
        })
        .json()
    );
  }

  public static async getV1TriggerOrders(req: {
    user: string;
    state: "active" | "past";
    mint?: string | undefined;
    offset: number;
    limit: number;
  }): Promise<V1List<V1TriggerOrder>> {
    return this.#collectV1Pages(req, (page) =>
      this.#v1Ky
        .get("getTriggerOrders", {
          searchParams: {
            user: req.user,
            orderStatus: req.state === "active" ? "active" : "history",
            page,
            ...(req.mint && { mint: req.mint }),
          },
        })
        .json()
    );
  }

  public static async postV1CancelOrders(req: {
    maker: string;
    orders?: string[] | undefined;
  }): Promise<{ transactions: string[]; requestId: string }> {
    return this.#v1Ky
      .post("cancelOrders", { json: { ...req, computeUnitPrice: "auto" } })
      .json();
  }

  public static async postV1Execute(req: {
    signedTransaction: string;
    requestId: string;
  }): Promise<V1ExecuteResponse> {
    return this.#v1Ky.post("execute", { json: req }).json();
  }

  public static async getV1DcaOrders(req: {
    user: string;
    state: "active" | "past";
    offset: number;
    limit: number;
  }): Promise<V1List<V1DcaOrder>> {
    const path = req.state === "active" ? "active-dca" : "historical-dca";
    return this.#collectV1Pages(req, (page) =>
      this.#workerKy
        .get(`${path}/v2/${req.user}`, {
          searchParams: { page, includeFailedTx: true },
        })
        .json()
    );
  }

  // V1 endpoints paginate by fixed-size pages; translate to offset/limit.
  static async #collectV1Pages<T>(
    req: { offset: number; limit: number },
    fetchPage: (page: number) => Promise<V1Page<T>>
  ): Promise<V1List<T>> {
    let page = Math.floor(req.offset / this.#V1_PAGE_SIZE) + 1;
    let skip = req.offset % this.#V1_PAGE_SIZE;
    const orders: T[] = [];
    let total = 0;
    while (orders.length < req.limit) {
      const res = await fetchPage(page);
      total = res.totalItems;
      orders.push(...res.orders.slice(skip, skip + req.limit - orders.length));
      skip = 0;
      if (page >= res.totalPages || res.orders.length === 0) {
        break;
      }
      page++;
    }
    return { orders, total };
  }

  static #historyParams(query: OrderHistoryQuery): Record<string, string> {
    const params: Record<string, string> = {
      state: query.state,
      limit: String(query.limit),
      offset: String(query.offset),
    };
    if (query.mint) {
      params.mint = query.mint;
    }
    return params;
  }

  // The web app refreshes once and replays the request on 401/403.
  static async #authed<T>(
    signer: Signer,
    request: (ky: KyInstance) => Promise<T>
  ): Promise<T> {
    const session = await this.#session(signer, false);
    try {
      return await request(this.#withToken(session.accessToken));
    } catch (err) {
      if (
        !(err instanceof HTTPError) ||
        (err.response.status !== 401 && err.response.status !== 403)
      ) {
        throw err;
      }
      const renewed = await this.#session(signer, true);
      return request(this.#withToken(renewed.accessToken));
    }
  }

  static #withToken(accessToken: string): KyInstance {
    return this.#ky.extend({
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  static async #session(
    signer: Signer,
    forceRenew: boolean
  ): Promise<AuthSession> {
    const cached = this.#loadSession(signer.address);
    if (
      cached &&
      !forceRenew &&
      new Date(cached.expiresAt).getTime() - Date.now() >
        this.#REFRESH_MARGIN_MS
    ) {
      return cached;
    }
    let session: AuthSession | null = null;
    if (cached) {
      session = await this.#ky
        .post("auth/refresh", { json: { refreshToken: cached.refreshToken } })
        .json<AuthSession>()
        .catch(() => null);
    }
    session ??= await this.#signIn(signer);
    this.#saveSession(signer.address, session);
    return session;
  }

  static async #signIn(signer: Signer): Promise<AuthSession> {
    const { challenge } = await this.#ky
      .post("auth/challenge", {
        json: { type: "message", walletPubkey: signer.address },
      })
      .json<{ challenge: string }>();
    const signature = getBase58Decoder().decode(
      await signer.signMessage(challenge)
    );
    return this.#ky
      .post("auth/verify", {
        json: {
          type: "message",
          walletPubkey: signer.address,
          signature,
          authMode: "access_refresh",
        },
      })
      .json();
  }

  static #sessionPath(address: string): string {
    return join(this.#AUTH_DIR, `${address}.json`);
  }

  static #loadSession(address: string): AuthSession | null {
    const path = this.#sessionPath(address);
    if (!existsSync(path)) {
      return null;
    }
    try {
      const session = JSON.parse(readFileSync(path, "utf-8")) as AuthSession;
      return session.accessToken && session.refreshToken ? session : null;
    } catch {
      return null;
    }
  }

  static #saveSession(address: string, session: AuthSession): void {
    mkdirSync(this.#AUTH_DIR, { recursive: true, mode: 0o700 });
    const path = this.#sessionPath(address);
    writeFileSync(
      path,
      JSON.stringify({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
      }),
      { mode: 0o600 }
    );
    chmodSync(path, 0o600);
  }
}
