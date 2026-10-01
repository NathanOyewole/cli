import { WALLET, type ParityCase } from "../types.ts";

// Wallets picked from datapi.jup.ag/v1/holders for the relevant mints.
const EARN_HOLDER = "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue"; // jlUSDC, jlUSDG
const SOL_EARN_HOLDER = "7uN7Lh2p86g23p6rv6zmSJWJgGr2EDTABTcMkLkCTXFH"; // jlWSOL
const PYUSD_HOLDER = "4AK83Vf82d1Q1zNsho5RSqHvBgkU7UvrKJCSz2bjdV3m";
const ETHENA_EARN_HOLDER = "C23FGxQB2LsoTbZsQr5w3R7b3sw5saxPLGJ4ujvyH34L"; // jlePYUSD
// Found via api.solana.fluid.io v2 borrowing/positions.
const BORROWER = "8RBYhetLKzr9ju9H2wDJ9W77dbCZXCPTKTK6KGfMv86n"; // vault 1 (SOL/USDC) position 10062
const JUPSOL_HOLDER = "3rfeoFgH8qYW1jRMjbLn1jCrotEBxeeYZ44Fqap5W3xj"; // margin for vault 4 (JupSOL/SOL)
const SOL_DEBT_BORROWER = "4opUjMGDNp15NF5UiEcuSSuuWYMyLy4bkJXrTWhPQRtb"; // vault 5 (JitoSOL/SOL) position 719, holds enough SOL to repay

const nonEmpty = (key: string) => (json: unknown) =>
  Array.isArray((json as Record<string, unknown>)[key]) &&
  ((json as Record<string, unknown[]>)[key]?.length ?? 0) > 0;

export const cases: ParityCase[] = [
  {
    id: "earn-tokens",
    feature: "lend-earn",
    kind: "read",
    args: ["lend", "earn", "tokens"],
    expect: nonEmpty("tokens"),
  },
  {
    id: "earn-tokens-ethena",
    feature: "lend-markets",
    kind: "read",
    args: ["lend", "earn", "tokens", "--market", "ethena"],
    expect: nonEmpty("tokens"),
  },
  {
    id: "earn-positions",
    feature: "lend-earn",
    kind: "read",
    args: ["lend", "earn", "positions", "--address", WALLET],
    wallet: EARN_HOLDER,
    expect: (json) =>
      (json as { positions: { earningsAmount: number }[] }).positions.some(
        (p) => p.earningsAmount > 0
      ),
  },
  {
    id: "earn-positions-ethena",
    feature: "lend-markets",
    kind: "read",
    args: ["lend", "earn", "positions", "--market", "ethena"],
    wallet: ETHENA_EARN_HOLDER,
    expect: nonEmpty("positions"),
  },
  {
    id: "earn-deposit",
    feature: "lend-earn",
    kind: "tx",
    args: ["lend", "earn", "deposit", "--token", "USDC", "--amount", "1"],
  },
  {
    id: "earn-deposit-sol",
    feature: "lend-earn",
    kind: "tx",
    args: ["lend", "earn", "deposit", "--token", "SOL", "--amount", "0.05"],
  },
  {
    id: "earn-withdraw",
    feature: "lend-earn",
    kind: "tx",
    args: ["lend", "earn", "withdraw", "--token", "USDC", "--amount", "1"],
    wallet: EARN_HOLDER,
  },
  {
    id: "earn-withdraw-all-sol",
    feature: "lend-earn",
    kind: "tx",
    args: ["lend", "earn", "withdraw", "--token", "SOL"],
    wallet: SOL_EARN_HOLDER,
  },
  {
    id: "earn-deposit-ethena",
    feature: "lend-markets",
    kind: "tx",
    args: [
      "lend",
      "earn",
      "deposit",
      "--market",
      "ethena",
      "--token",
      "PYUSD",
      "--amount",
      "10",
    ],
    wallet: PYUSD_HOLDER,
  },
  {
    id: "earn-withdraw-ethena",
    feature: "lend-markets",
    kind: "tx",
    args: [
      "lend",
      "earn",
      "withdraw",
      "--market",
      "ethena",
      "--token",
      "PYUSD",
      "--amount",
      "10",
    ],
    wallet: ETHENA_EARN_HOLDER,
  },
  {
    id: "earn-history",
    feature: "lend-earn",
    kind: "read",
    args: ["lend", "earn", "history", "--address", WALLET],
    wallet: EARN_HOLDER,
    expect: nonEmpty("history"),
  },
  {
    id: "earn-chart",
    feature: "lend-earn",
    kind: "read",
    args: ["lend", "earn", "chart", "--token", "USDC", "--range", "7d"],
    expect: nonEmpty("points"),
  },
  {
    id: "borrow-vaults",
    feature: "lend-borrow",
    kind: "read",
    args: ["lend", "borrow", "vaults"],
    expect: nonEmpty("vaults"),
  },
  {
    id: "borrow-vault",
    feature: "lend-borrow",
    kind: "read",
    args: ["lend", "borrow", "vault", "--vault", "1"],
    expect: (json) => (json as { oraclePrice: number }).oraclePrice > 0,
  },
  {
    id: "borrow-positions",
    feature: "lend-borrow",
    kind: "read",
    args: ["lend", "borrow", "positions", "--address", WALLET],
    wallet: BORROWER,
    expect: (json) =>
      (json as { positions: { ltvPct: number }[] }).positions.some(
        (p) => p.ltvPct > 0
      ),
  },
  {
    id: "borrow-history",
    feature: "lend-borrow",
    kind: "read",
    args: ["lend", "borrow", "history", "--position", "10062"],
    wallet: BORROWER,
    expect: nonEmpty("history"),
  },
  {
    id: "borrow-liquidations",
    feature: "lend-borrow",
    kind: "read",
    args: [
      "lend",
      "borrow",
      "liquidations",
      "--position",
      "10062",
      "--vault",
      "1",
    ],
  },
  {
    id: "borrow-open",
    feature: "lend-borrow",
    kind: "tx",
    args: [
      "lend",
      "borrow",
      "open",
      "--vault",
      "1",
      "--collateral",
      "0.1",
      "--borrow",
      "5",
    ],
  },
  {
    id: "borrow-deposit",
    feature: "lend-borrow",
    kind: "tx",
    args: [
      "lend",
      "borrow",
      "deposit",
      "--position",
      "10062",
      "--amount",
      "0.1",
    ],
    wallet: BORROWER,
  },
  {
    id: "borrow-borrow",
    feature: "lend-borrow",
    kind: "tx",
    args: ["lend", "borrow", "borrow", "--position", "10062", "--amount", "10"],
    wallet: BORROWER,
  },
  {
    id: "borrow-repay",
    feature: "lend-borrow",
    kind: "tx",
    args: ["lend", "borrow", "repay", "--position", "719", "--amount", "0.01"],
    wallet: SOL_DEBT_BORROWER,
  },
  {
    id: "borrow-withdraw",
    feature: "lend-borrow",
    kind: "tx",
    args: [
      "lend",
      "borrow",
      "withdraw",
      "--position",
      "10062",
      "--amount",
      "1",
    ],
    wallet: BORROWER,
  },
  {
    id: "borrow-operate",
    feature: "lend-borrow",
    kind: "tx",
    args: [
      "lend",
      "borrow",
      "operate",
      "--position",
      "719",
      "--repay",
      "0.01",
      "--withdraw",
      "0.01",
    ],
    wallet: SOL_DEBT_BORROWER,
  },
  {
    id: "borrow-repay-all-sol",
    feature: "lend-borrow",
    kind: "tx",
    args: ["lend", "borrow", "repay", "--position", "719"],
    wallet: SOL_DEBT_BORROWER,
  },
  {
    id: "borrow-close",
    feature: "lend-borrow",
    kind: "tx",
    args: ["lend", "borrow", "close", "--position", "719"],
    wallet: SOL_DEBT_BORROWER,
  },

  {
    id: "markets",
    feature: "lend-markets",
    kind: "read",
    args: ["lend", "markets"],
    expect: (json) => (json as { markets: unknown[] }).markets.length === 2,
  },
  {
    id: "stats-earn",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "stats", "earn"],
    expect: nonEmpty("tokens"),
  },
  {
    id: "stats-borrow",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "stats", "borrow"],
    expect: (json) => (json as { totalBorrowUsd: number }).totalBorrowUsd > 0,
  },
  {
    id: "stats-liquidity",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "stats", "liquidity"],
    expect: nonEmpty("tokens"),
  },
  {
    id: "stats-dex",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "stats", "dex"],
    expect: nonEmpty("pools"),
  },
  {
    id: "stats-positions",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "stats", "positions", "--vault", "1", "--sort", "borrow"],
    expect: nonEmpty("positions"),
  },
  {
    id: "strategies",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "strategies"],
    expect: nonEmpty("strategies"),
  },
  {
    id: "calculator",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "calculator", "--vault", "4", "--leverage", "5"],
    expect: nonEmpty("scenarios"),
  },
  {
    id: "transparency",
    feature: "lend-tools",
    kind: "read",
    args: ["lend", "transparency", "--market", "ethena"],
    expect: nonEmpty("multisigs"),
  },
  {
    id: "refinance",
    feature: "lend-tools",
    kind: "unsupported",
    reason:
      "refinance reads Kamino/Marginfi/Save positions from an internal portfolio API that needs a private bearer token (NEXT_PUBLIC_LEND_PORTFOLIO_API_BEARER, not public)",
  },

  {
    id: "multiply-vaults",
    feature: "lend-multiply-smart",
    kind: "read",
    args: ["lend", "multiply", "vaults"],
    expect: nonEmpty("vaults"),
  },
  {
    id: "smart-vaults",
    feature: "lend-multiply-smart",
    kind: "read",
    args: ["lend", "borrow", "vaults", "--smart"],
    expect: nonEmpty("vaults"),
  },
  {
    id: "multiply-open",
    feature: "lend-multiply-smart",
    kind: "tx",
    args: [
      "lend",
      "multiply",
      "open",
      "--vault",
      "4",
      "--amount",
      "1",
      "--leverage",
      "3",
    ],
    wallet: JUPSOL_HOLDER,
  },
  {
    id: "multiply-leverage-up",
    feature: "lend-multiply-smart",
    kind: "tx",
    args: ["lend", "multiply", "set", "--position", "10062", "--leverage", "2"],
    wallet: BORROWER,
  },
  {
    id: "multiply-deleverage",
    feature: "lend-multiply-smart",
    kind: "tx",
    args: [
      "lend",
      "multiply",
      "set",
      "--position",
      "10062",
      "--leverage",
      "1.1",
    ],
    wallet: BORROWER,
  },
  {
    id: "multiply-close",
    feature: "lend-multiply-smart",
    kind: "tx",
    args: ["lend", "multiply", "close", "--position", "10062"],
    wallet: BORROWER,
  },
  {
    id: "smart-vault-operate",
    feature: "lend-multiply-smart",
    kind: "unsupported",
    reason:
      "smart (DEX) vault deposit/borrow/repay/withdraw, Smart Earn and Smart Multiply: lite-api lend/v1/borrow/operate rejects DEX vaults ('use getOperateDexIx from @jup-ag/lend/smart-vaults'); that SDK path needs @coral-xyz/anchor + @solana/web3.js (well over the 500 KB budget) plus its DEX share/slippage math",
  },
  // Earn Vaults (jup.ag/earn), rechecked 2026-10-01: jup.ag/earn and the web's
  // API base vaults.jup.ag/v1/* return 404. vaults.jup.ag now serves a separate
  // curator console whose /api has no user deposit or withdraw builders.
  ...(
    [
      ["earn-list", "vault list"],
      ["earn-detail", "vault detail, performance, allocation and activity"],
      ["earn-positions", "wallet positions and withdrawal requests"],
      [
        "earn-simulation",
        "deposit, instant withdraw, queued requests and claims (server-built txs under /v1/vaults/:id/transactions)",
      ],
    ] as const
  ).map(
    ([feature, what]): ParityCase => ({
      id: feature,
      feature,
      kind: "unsupported",
      reason: `backend not live in production (vaults.jup.ag 404 on 2026-10-01): ${what}; jup.ag/earn also 404s and only staging api.raccoons.dev/vault serves this API`,
    })
  ),
  {
    id: "earn-mobile",
    feature: "earn-mobile",
    kind: "unsupported",
    reason: "UI-only: mobile layout of the Earn Vaults pages",
  },
  {
    id: "earn-access",
    feature: "earn-access",
    kind: "unsupported",
    reason:
      "whitelist registration (POST yield-store.raccoons.dev/v1/beta/register) needs a Cloudflare Turnstile captchaToken",
  },
];
