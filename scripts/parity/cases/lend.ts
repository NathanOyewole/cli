import { WALLET, type ParityCase } from "../types.ts";

// Wallets picked from datapi.jup.ag/v1/holders for the relevant mints.
const EARN_HOLDER = "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue"; // jlUSDC, jlUSDG
const SOL_EARN_HOLDER = "7uN7Lh2p86g23p6rv6zmSJWJgGr2EDTABTcMkLkCTXFH"; // jlWSOL
const PYUSD_HOLDER = "4AK83Vf82d1Q1zNsho5RSqHvBgkU7UvrKJCSz2bjdV3m";
const ETHENA_EARN_HOLDER = "C23FGxQB2LsoTbZsQr5w3R7b3sw5saxPLGJ4ujvyH34L"; // jlePYUSD

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
];
