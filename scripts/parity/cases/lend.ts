import { WALLET, type ParityCase } from "../types.ts";

// Largest jlUSDC holder per datapi holders list.
const EARN_HOLDER = "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue";

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
    id: "earn-positions",
    feature: "lend-earn",
    kind: "read",
    args: ["lend", "earn", "positions", "--address", WALLET],
    wallet: EARN_HOLDER,
    expect: nonEmpty("positions"),
  },
  {
    id: "earn-deposit",
    feature: "lend-earn",
    kind: "tx",
    args: ["lend", "earn", "deposit", "--token", "USDC", "--amount", "1"],
  },
  {
    id: "earn-withdraw",
    feature: "lend-earn",
    kind: "tx",
    args: ["lend", "earn", "withdraw", "--token", "USDC", "--amount", "1"],
    wallet: EARN_HOLDER,
  },
];
