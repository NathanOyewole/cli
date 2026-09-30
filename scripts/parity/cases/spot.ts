import { WALLET, type ParityCase } from "../types.ts";

export const cases: ParityCase[] = [
  {
    id: "search",
    feature: "shared-search",
    kind: "read",
    args: ["spot", "tokens", "--search", "JUP"],
  },
  {
    id: "quote",
    feature: "swap-quote",
    kind: "read",
    args: ["spot", "quote", "--from", "SOL", "--to", "USDC", "--amount", "1"],
  },
  {
    id: "swap",
    feature: "swap-quote",
    kind: "tx",
    args: ["spot", "swap", "--from", "SOL", "--to", "USDC", "--amount", "0.01"],
  },
  {
    id: "portfolio",
    feature: "portfolio-tabs",
    kind: "read",
    args: ["spot", "portfolio", "--address", WALLET],
  },
  {
    id: "history",
    feature: "portfolio-tabs",
    kind: "read",
    args: ["spot", "history", "--address", WALLET, "--limit", "2"],
    expect: (json) => Array.isArray((json as { trades?: unknown }).trades),
  },
  {
    id: "transfer",
    feature: "send-tabs",
    kind: "tx",
    args: [
      "spot",
      "transfer",
      "--token",
      "USDC",
      "--to",
      "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV",
      "--amount",
      "0.01",
    ],
  },
];
