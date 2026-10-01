import { WALLET, type ParityCase } from "../types.ts";

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
// Most active wallet on the Smart Money leaderboard when this was written.
const ACTIVE_TRADER = "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue";

type Json = Record<string, unknown>;
const nonEmpty = (key: string) => (json: unknown) =>
  Array.isArray((json as Json)[key]) &&
  ((json as Json)[key] as unknown[]).length > 0;
const isArray = (key: string) => (json: unknown) =>
  Array.isArray((json as Json)[key]);

const list = (id: string, name: string, extra: string[] = []): ParityCase => ({
  id: `list-${id}`,
  feature: "spot-lists",
  kind: "read",
  args: ["spot", "tokens", "--list", name, "--limit", "5", ...extra],
  expect: nonEmpty("tokens"),
});

const token = (
  sub: string,
  extra: string[] = [],
  expect?: (json: unknown) => boolean
): ParityCase => ({
  id: `token-${sub}`,
  feature: "spot-token",
  kind: "read",
  args: ["spot", "token", sub, "--token", JUP, ...extra],
  ...(expect && { expect }),
});

export const cases: ParityCase[] = [
  {
    id: "landing-pulse",
    feature: "spot-landing",
    kind: "read",
    args: ["spot", "pulse"],
    expect: (json) => typeof (json as Json).summary === "string",
  },
  {
    id: "landing-heatmap",
    feature: "spot-landing",
    kind: "read",
    args: ["spot", "heatmap", "--limit", "5"],
    expect: nonEmpty("categories"),
  },
  {
    id: "landing-popular",
    feature: "spot-landing",
    kind: "read",
    args: ["spot", "tokens", "--list", "popular", "--limit", "10"],
    expect: nonEmpty("tokens"),
  },
  {
    id: "landing-featured",
    feature: "spot-landing",
    kind: "read",
    args: [
      "spot",
      "tokens",
      "--list",
      "trending",
      "--interval",
      "1h",
      "--sort",
      "netVolume",
      "--limit",
      "9",
    ],
    expect: nonEmpty("tokens"),
  },
  list("trending", "trending", ["--interval", "5m"]),
  list("toptraded", "toptraded", ["--interval", "6h"]),
  list("organic", "organic"),
  list("recent", "recent"),
  list("stocks", "stocks"),
  list("stablecoins", "stablecoins", ["--interval", "7d", "--only-yb"]),
  list("meme", "meme", ["--sort", "mcap"]),
  list("filtered", "toptraded", ["--min-mcap", "1000000", "--verified"]),
  {
    id: "list-runners",
    feature: "spot-lists",
    kind: "read",
    args: ["spot", "tokens", "--list", "runners"],
    expect: isArray("tokens"),
  },
  {
    id: "stocks-catalog",
    feature: "spot-lists",
    kind: "read",
    args: ["spot", "stocks", "--limit", "5"],
    expect: nonEmpty("stocks"),
  },
  {
    id: "alphascan",
    feature: "spot-discovery",
    kind: "read",
    args: ["spot", "alphascan", "--limit", "5"],
    expect: nonEmpty("new"),
  },
  {
    id: "alphascan-filtered",
    feature: "spot-discovery",
    kind: "read",
    args: [
      "spot",
      "alphascan",
      "--tab",
      "graduated",
      "--launchpad",
      "pump.fun",
      "--min-mcap",
      "10000",
    ],
    expect: isArray("graduated"),
  },
  {
    id: "categories",
    feature: "spot-discovery",
    kind: "read",
    args: ["spot", "categories"],
    expect: nonEmpty("categories"),
  },
  {
    id: "launchpads",
    feature: "spot-discovery",
    kind: "read",
    args: ["spot", "launchpads", "--interval", "7d"],
    expect: nonEmpty("launchpads"),
  },
  {
    id: "smart-money-wallets",
    feature: "spot-discovery",
    kind: "read",
    args: ["spot", "smart-money", "wallets", "--category", "whales"],
    expect: nonEmpty("wallets"),
  },
  {
    id: "smart-money-trades",
    feature: "spot-discovery",
    kind: "read",
    args: ["spot", "smart-money", "trades"],
    expect: isArray("trades"),
  },
  {
    id: "smart-money-summary",
    feature: "spot-discovery",
    kind: "read",
    args: ["spot", "smart-money", "summary", "--side", "buy"],
    expect: nonEmpty("tokens"),
  },
  token("info", [], (json) => (json as Json).priceUsd !== null),
  token("chart", ["--interval", "1h", "--candles", "10"], nonEmpty("candles")),
  {
    ...token(
      "chart",
      ["--type", "mcap", "--quote", "sol"],
      nonEmpty("candles")
    ),
    id: "token-chart-mcap-sol",
  },
  token("net-volume", ["--interval", "1h"], nonEmpty("points")),
  token("holders", ["--limit", "5"], nonEmpty("holders")),
  token("traders", ["--limit", "5"], nonEmpty("traders")),
  token("txs", ["--side", "buy", "--limit", "5"], nonEmpty("txs")),
  token("dev"),
  token("pools", [], nonEmpty("pools")),
  token("about", [], (json) => typeof (json as Json).description === "string"),
  {
    id: "watchlist-list",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "watchlist", "list"],
    expect: nonEmpty("entries"),
  },
  {
    id: "watchlist-add",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "watchlist", "add", "--token", "BONK", "--name", "parity"],
  },
  {
    id: "watchlist-add-stock",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "watchlist", "add", "--stock", "NVDA", "--name", "parity"],
  },
  {
    id: "watchlist-list-named",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "watchlist", "list", "--name", "parity"],
    expect: (json) => ((json as Json).entries as unknown[]).length === 2,
  },
  {
    id: "watchlist-delete",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "watchlist", "delete", "--name", "parity"],
  },
  {
    id: "tracker-add",
    feature: "spot-personal",
    kind: "read",
    args: [
      "spot",
      "tracker",
      "add",
      "--address",
      ACTIVE_TRADER,
      "--name",
      "parity",
    ],
  },
  {
    id: "tracker-list",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "tracker", "list"],
    expect: nonEmpty("wallets"),
  },
  {
    id: "tracker-trades",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "tracker", "trades", "--limit", "5"],
    expect: isArray("trades"),
  },
  {
    id: "tracker-holders",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "token", "holders", "--token", JUP, "--tag", "tracked"],
    expect: isArray("holders"),
  },
  {
    id: "tracker-export",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "tracker", "export"],
    expect: (json) => Array.isArray(json) && json.length === 1,
  },
  {
    id: "tracker-remove",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "tracker", "remove", "--address", ACTIVE_TRADER],
  },
  {
    id: "positions",
    feature: "spot-personal",
    kind: "read",
    args: ["spot", "portfolio", "--address", WALLET],
  },
];
