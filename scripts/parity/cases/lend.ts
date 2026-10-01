import { WALLET, type ParityCase } from "../types.ts";

// Wallets picked from datapi.jup.ag/v1/holders for the relevant mints.
const EARN_HOLDER = "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue"; // jlUSDC, jlUSDG
const SOL_EARN_HOLDER = "7uN7Lh2p86g23p6rv6zmSJWJgGr2EDTABTcMkLkCTXFH"; // jlWSOL
const PYUSD_HOLDER = "4AK83Vf82d1Q1zNsho5RSqHvBgkU7UvrKJCSz2bjdV3m";
const ETHENA_EARN_HOLDER = "C23FGxQB2LsoTbZsQr5w3R7b3sw5saxPLGJ4ujvyH34L"; // jlePYUSD
// Found via api.solana.fluid.io v2 borrowing/positions.
const BORROWER = "8RBYhetLKzr9ju9H2wDJ9W77dbCZXCPTKTK6KGfMv86n"; // vault 1 (SOL/USDC) position 10062
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
    args: ["lend", "borrow", "repay", "--position", "10062", "--amount", "10"],
    wallet: BORROWER,
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
      "10062",
      "--repay",
      "5",
      "--withdraw",
      "0.5",
    ],
    wallet: BORROWER,
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
];
