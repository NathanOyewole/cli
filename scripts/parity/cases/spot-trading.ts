import { getAddressDecoder, getBase64Codec } from "@solana/kit";

import { UNFUNDED_SIM_ERROR, type ParityCase } from "../types.ts";

// Public wallets with legacy V1 orders, found via the V1 programs' recent txs.
const V1_TRIGGER_WALLET = "9v3JUtVwZ6N7MLRonkCdLVjpuP3tMJBJvo9ATWRpXhj9";
const V1_DCA_WALLET = "9UZrTuJMwUn8J57tVWdFQKfXz3fQM1w9jkr7LkuWXP8a";
// Token-2022 mint with a 3% transfer fee, which Shield always flags.
const TRANSFER_FEE_MINT = "4zfwqBtYpDjdiocYL91bc4h2qoeuD13MwgbiZWbECPTE";

const DCA_V1_PROGRAM = "DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// Any open V1 DCA account works: closing deletes the account, so every one
// the program owns is still open. USDC -> SOL keeps both legs plain SPL.
async function openV1Dca(): Promise<Record<string, string>> {
  const res = await fetch(
    process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getProgramAccounts",
        params: [
          DCA_V1_PROGRAM,
          {
            encoding: "base64",
            dataSlice: { offset: 8, length: 96 },
            filters: [
              { memcmp: { offset: 40, bytes: USDC_MINT } },
              { memcmp: { offset: 72, bytes: SOL_MINT } },
            ],
          },
        ],
      }),
    }
  );
  const { result, error } = (await res.json()) as {
    result?: { pubkey: string; account: { data: [string, string] } }[];
    error?: { message: string };
  };
  if (!result) {
    throw new Error(`getProgramAccounts: ${error?.message ?? res.status}`);
  }
  const decoder = getAddressDecoder();
  for (const { pubkey, account } of result) {
    const data = getBase64Codec().encode(account.data[0]);
    const [user, input, output] = [0, 32, 64].map((o) =>
      decoder.decode(data, o)
    );
    if (input === USDC_MINT && output === SOL_MINT) {
      return { WALLET: user!, ORDER: pubkey };
    }
  }
  throw new Error("no open USDC -> SOL V1 DCA order found");
}

type OrderList = { count: number; orders: unknown[] };
const isOrderList = (json: unknown): json is OrderList =>
  typeof (json as OrderList).count === "number" &&
  Array.isArray((json as OrderList).orders);
const hasOrders = (json: unknown) =>
  isOrderList(json) && json.orders.length > 0;

export const cases: ParityCase[] = [
  {
    id: "quote-shield-warnings",
    feature: "swap-quote",
    kind: "read",
    args: [
      "spot",
      "quote",
      "--from",
      "USDC",
      "--to",
      TRANSFER_FEE_MINT,
      "--amount",
      "10",
    ],
    expect: (json) =>
      (json as { warnings: { type: string }[] }).warnings.some((w) =>
        w.type.endsWith("_TRANSFER_FEES")
      ),
  },
  {
    id: "quote-exact-out",
    feature: "swap-amount",
    kind: "read",
    args: [
      "spot",
      "quote",
      "--from",
      "SOL",
      "--to",
      "USDC",
      "--amount",
      "5",
      "--exact-out",
    ],
    expect: (json) => (json as { outAmount: string }).outAmount === "5",
  },
  {
    id: "swap-manual-settings",
    feature: "swap-amount",
    kind: "tx",
    args: [
      "spot",
      "swap",
      "--from",
      "SOL",
      "--to",
      "USDC",
      "--amount",
      "1",
      "--exact-out",
      "--priority-fee",
      "20000",
      "--fee-type",
      "exact-fee",
      "--exclude-routers",
      "jupiterz",
    ],
  },
  {
    id: "limit-orders",
    feature: "limit-intent",
    kind: "read",
    key: "generated",
    args: ["spot", "limit", "orders"],
    expect: isOrderList,
  },
  {
    id: "limit-history",
    feature: "limit-intent",
    kind: "read",
    key: "generated",
    args: ["spot", "limit", "history", "--limit", "5"],
    expect: isOrderList,
  },
  {
    id: "limit-open-take-profit",
    feature: "limit-amount",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "limit",
      "open",
      "--from",
      "SOL",
      "--to",
      "USDC",
      "--amount",
      "0.2",
      "--intent",
      "take-profit",
      "--price",
      "+10%",
    ],
  },
  {
    id: "limit-open-trailing-stop",
    feature: "limit-intent",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "limit",
      "open",
      "--from",
      "SOL",
      "--to",
      "USDC",
      "--amount",
      "0.2",
      "--intent",
      "trailing-stop",
      "--trailing",
      "5",
      "--expiry",
      "1d",
    ],
  },
  {
    id: "limit-open-oco",
    feature: "limit-intent",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "limit",
      "open",
      "--from",
      "SOL",
      "--to",
      "USDC",
      "--amount",
      "0.2",
      "--intent",
      "oco",
      "--tp",
      "+20%",
      "--sl",
      "-10%",
    ],
  },
  {
    id: "limit-open-otoco",
    feature: "limit-intent",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "limit",
      "open",
      "--from",
      "SOL",
      "--to",
      "JUP",
      "--amount",
      "0.2",
      "--intent",
      "otoco",
      "--price",
      "-5%",
      "--tp",
      "+30%",
      "--sl",
      "-10%",
      "--expiry",
      "30d",
    ],
  },
  {
    id: "limit-open-buy-dip-mcap",
    feature: "limit-intent",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "limit",
      "open",
      "--from",
      "SOL",
      "--to",
      "JUP",
      "--amount",
      "0.2",
      "--intent",
      "buy-dip",
      "--price",
      "500000000",
      "--mcap",
    ],
  },
  {
    id: "limit-orders-v1",
    feature: "limit-intent",
    kind: "read",
    args: ["spot", "limit", "orders", "--v1", "--address", V1_TRIGGER_WALLET],
    expect: isOrderList,
  },
  {
    id: "limit-history-v1",
    feature: "limit-intent",
    kind: "read",
    args: ["spot", "limit", "history", "--v1", "--address", V1_TRIGGER_WALLET],
    expect: hasOrders,
  },
  {
    id: "limit-close-v1-all",
    feature: "limit-intent",
    kind: "tx",
    wallet: V1_TRIGGER_WALLET,
    args: ["spot", "limit", "close", "--v1", "--order", "all"],
  },
  {
    id: "dca-orders",
    feature: "recurring-interval",
    kind: "read",
    key: "generated",
    args: ["spot", "dca", "orders"],
    expect: isOrderList,
  },
  {
    id: "dca-history",
    feature: "recurring-interval",
    kind: "read",
    key: "generated",
    args: ["spot", "dca", "history", "--limit", "5"],
    expect: isOrderList,
  },
  {
    id: "dca-open",
    feature: "recurring-amount",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "dca",
      "open",
      "--from",
      "SOL",
      "--to",
      "JUP",
      "--amount",
      "0.5",
      "--orders",
      "4",
      "--interval",
      "1d",
    ],
  },
  {
    id: "dca-open-price-range",
    feature: "recurring-interval",
    kind: "tx",
    key: "generated",
    expectSimError: UNFUNDED_SIM_ERROR,
    args: [
      "spot",
      "dca",
      "open",
      "--from",
      "SOL",
      "--to",
      "JUP",
      "--amount",
      "0.5",
      "--orders",
      "2",
      "--interval",
      "1w",
      "--min-price",
      "0.01",
      "--max-price",
      "100",
    ],
  },
  {
    id: "dca-orders-v1",
    feature: "recurring-interval",
    kind: "read",
    args: ["spot", "dca", "orders", "--v1", "--address", V1_DCA_WALLET],
    expect: isOrderList,
  },
  {
    id: "dca-history-v1",
    feature: "recurring-interval",
    kind: "read",
    args: ["spot", "dca", "history", "--v1", "--address", V1_DCA_WALLET],
    expect: hasOrders,
  },
  {
    id: "dca-close-v1",
    feature: "recurring-interval",
    kind: "tx",
    resolve: openV1Dca,
    args: ["spot", "dca", "close", "--v1", "--order", "$ORDER"],
  },
];
