import { WALLET, type ParityCase } from "../types.ts";

const API = "https://lite-api.jup.ag/prediction/v1";

// Wallets and markets seen live on 2026-10-01. Positions, claims and resting
// orders change hourly, so the run re-discovers them and falls back to these.
const FALLBACK = {
  trader: "DVHD66wYT5wFcgJ9K2SbtJTmbsJxzz6chkAzNwzbksdT",
  position: "1WN14nTQg6YohWLqHMg4q4Gj5TPrZPEnxc7p7ZiG62h",
  claimer: "F5JpA15TzvVX1ZmvB2WVdPqEiBPSEsgvnvfxkf25LAgn",
  limitOrderOwner: "Aviv8GboDaosPfCCfkdp2wJakMaZUijeuPjTvfmmZcy3",
  limitOrder: "BJSfbvssqnZpGj8ptoyXD8EWRizpiWxmTqvZzKM3gpiG",
  arcader: "GuP8ysGU8Y3sT6uzTZrU1SuqHFvqtNazStFzMXaur6dc",
};
const KALSHI_MARKET = "SENATETX-26-D";
// Kalshi buys are disabled server-side (`kalshi_buys_disabled`), so buys use Polymarket.
const POLYMARKET_MARKET = "POLY-1357374";
const POLYMARKET_EVENT = "POLY-202857";
const EVENT_IDS = "WRECSS-26,SENATETX-26";
const CLAN = "arcaders";

type Json = Record<string, unknown> & { data?: Record<string, unknown>[] };

async function get(path: string): Promise<Json | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${API}/${path}`).catch(() => null);
    if (res?.status === 429) {
      await Bun.sleep(3000 * (attempt + 1));
      continue;
    }
    return res?.ok ? ((await res.json()) as Json) : null;
  }
  return null;
}

async function findWallet<T>(
  candidates: string[],
  probe: (wallet: string) => Promise<T | null>
): Promise<{ wallet: string; found: T } | null> {
  for (const wallet of candidates) {
    const found = await probe(wallet);
    if (found) {
      return { wallet, found };
    }
    await Bun.sleep(300);
  }
  return null;
}

async function discover() {
  const positionsOf = async (w: string) =>
    (await get(`positions?ownerPubkey=${w}&includePrices=true`))?.data ?? [];
  const sellable = async (w: string) =>
    (await positionsOf(w)).find(
      (p) =>
        !p.claimable &&
        Number(p.sellPriceUsd ?? 0) > 50_000 &&
        BigInt(String(p.contractsMicro)) >= 20_000_000n
    )?.pubkey as string | undefined;
  const claimable = async (w: string) =>
    (await positionsOf(w)).some((p) => p.claimable) ? w : null;
  const restingOrder = async (w: string) =>
    (await get(`orders?ownerPubkey=${w}&start=0&end=20`))?.data?.find(
      (o) => o.status === "pending" && o.orderType === "limit"
    )?.pubkey as string | undefined;

  const board =
    (await get("leaderboards?period=weekly&metric=volume&limit=15"))?.data ??
    [];
  const candidates = [
    ...new Set(board.map((r) => String(r.ownerPubkey)).filter(Boolean)),
  ];

  const trader = (await findWallet(
    [FALLBACK.trader, ...candidates],
    async (w) => (await sellable(w)) ?? null
  )) ?? { wallet: FALLBACK.trader, found: FALLBACK.position };
  const claimer = await findWallet(
    [FALLBACK.claimer, ...candidates],
    claimable
  );
  const limitOrder = await findWallet(
    [FALLBACK.limitOrderOwner, ...candidates],
    async (w) => (await restingOrder(w)) ?? null
  );
  const timed = await get("events/crypto/timed?subcategory=btc&tags=15m");
  const nowSec = Date.now() / 1000;
  const upcoming = (timed?.data ?? [])
    .filter((e) => Number(e.beginAt) > nowSec)
    .sort((a, b) => Number(a.beginAt) - Number(b.beginAt))[0] as
    | { markets: { marketId: string }[] }
    | undefined;

  return {
    trader: trader.wallet,
    position: trader.found,
    claimer: claimer?.wallet ?? null,
    limitOrderOwner: limitOrder?.wallet ?? null,
    limitOrder: limitOrder?.found ?? null,
    timedMarket: upcoming?.markets[0]?.marketId ?? null,
  };
}

const areas = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const live =
  !process.argv.includes("--coverage") &&
  (areas.length === 0 || areas.includes("predict"));
const found = live
  ? await discover()
  : {
      trader: FALLBACK.trader,
      position: FALLBACK.position,
      claimer: FALLBACK.claimer,
      limitOrderOwner: FALLBACK.limitOrderOwner,
      limitOrder: FALLBACK.limitOrder,
      timedMarket: null,
    };

const nonEmpty =
  (key: string) =>
  (json: unknown): boolean => {
    const value = (json as Record<string, unknown>)[key];
    return Array.isArray(value) && value.length > 0;
  };
const hasKey =
  (key: string) =>
  (json: unknown): boolean =>
    json !== null && typeof json === "object" && key in json;
const signedPreview = (json: unknown): boolean => {
  const j = json as { dryRun?: boolean; message?: string };
  return j.dryRun === true && typeof j.message === "string";
};

const feed: ParityCase[] = [
  {
    id: "events",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "events", "--category", "crypto", "--limit", "3"],
    expect: nonEmpty("events"),
  },
  {
    id: "events-subcategory",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "events", "--subcategory", "nfl", "--limit", "3"],
    expect: nonEmpty("events"),
  },
  {
    id: "events-search",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "events", "--search", "bitcoin", "--limit", "3"],
  },
  {
    id: "events-by-id",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "events", "--id", EVENT_IDS],
    expect: nonEmpty("events"),
  },
  {
    id: "categories",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "categories", "--category", "crypto"],
    expect: nonEmpty("tags"),
  },
  {
    id: "suggested",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "suggested", "--limit", "3"],
    expect: nonEmpty("events"),
  },
  {
    id: "market",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "market", "--id", KALSHI_MARKET],
    expect: hasKey("rulesPrimary"),
  },
  {
    id: "price-history",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "price-history", "--market", POLYMARKET_MARKET],
    expect: nonEmpty("history"),
  },
  {
    id: "score",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "score", "--event", "SENATETX-26"],
    expect: hasKey("score"),
  },
  {
    id: "trades",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "trades", "--limit", "5"],
    expect: nonEmpty("trades"),
  },
  {
    id: "orderbook",
    feature: "predict-feed",
    kind: "read",
    args: ["predictions", "orderbook", "--market", KALSHI_MARKET],
    expect: (json) =>
      (json as { yes?: { bids?: unknown[] } }).yes?.bids?.length !== 0,
  },
  {
    id: "open-market",
    feature: "predict-feed",
    kind: "tx",
    wallet: found.trader,
    args: [
      "predictions",
      "open",
      "--market",
      POLYMARKET_MARKET,
      "--side",
      "yes",
      "--amount",
      "5",
    ],
  },
  {
    id: "open-limit",
    feature: "predict-feed",
    kind: "tx",
    wallet: found.trader,
    args: [
      "predictions",
      "open",
      "--market",
      POLYMARKET_MARKET,
      "--side",
      "y",
      "--amount",
      "5",
      "--limit",
      "0.02",
    ],
  },
  {
    id: "open-saba-ticket",
    feature: "predict-feed",
    kind: "unsupported",
    reason:
      "Saba (gx) ticket buys are wired into `predictions open`, but no Saba market is listed to build against (newest ticket 2026-07-19)",
  },
];

const timed: ParityCase[] = [
  {
    id: "timed-crypto",
    feature: "predict-timed",
    kind: "read",
    args: ["predictions", "timed", "--asset", "btc", "--interval", "15m"],
    expect: nonEmpty("upcoming"),
  },
  {
    id: "timed-stocks",
    feature: "predict-timed",
    kind: "read",
    args: ["predictions", "timed", "--asset", "spcx", "--interval", "15m"],
    expect: hasKey("current"),
  },
  found.timedMarket
    ? {
        id: "timed-open",
        feature: "predict-timed",
        kind: "tx",
        wallet: found.trader,
        args: [
          "predictions",
          "open",
          "--market",
          found.timedMarket,
          "--side",
          "yes",
          "--amount",
          "5",
        ],
      }
    : {
        id: "timed-open",
        feature: "predict-timed",
        kind: "unsupported",
        reason: "skipped: no upcoming BTC 15m market found at run time",
      },
];

const arcade: ParityCase[] = [
  {
    id: "arcade-rounds",
    feature: "predict-arcade",
    kind: "read",
    args: ["predictions", "arcade", "rounds", "--asset", "SOL"],
    expect: hasKey("next"),
  },
  {
    id: "arcade-history",
    feature: "predict-arcade",
    kind: "read",
    wallet: FALLBACK.arcader,
    args: ["predictions", "arcade", "history", "--address", WALLET],
    expect: nonEmpty("history"),
  },
  {
    id: "arcade-positions",
    feature: "predict-arcade",
    kind: "read",
    wallet: FALLBACK.arcader,
    args: ["predictions", "arcade", "positions", "--address", WALLET],
    expect: hasKey("positions"),
  },
  {
    id: "arcade-open",
    feature: "predict-arcade",
    kind: "tx",
    wallet: FALLBACK.arcader,
    args: [
      "predictions",
      "arcade",
      "open",
      "--asset",
      "BTC",
      "--side",
      "down",
      "--amount",
      "1",
    ],
  },
  {
    id: "arcade-chat",
    feature: "predict-arcade",
    kind: "read",
    args: ["predictions", "comments", "list", "--arcade", "--limit", "3"],
    expect: nonEmpty("comments"),
  },
];

const community: ParityCase[] = [
  {
    id: "clans-list",
    feature: "predict-community",
    kind: "read",
    args: ["predictions", "clans", "list", "--limit", "5"],
    expect: nonEmpty("clans"),
  },
  {
    id: "clans-get",
    feature: "predict-community",
    kind: "read",
    args: ["predictions", "clans", "get", "--clan", CLAN],
    expect: nonEmpty("members"),
  },
  {
    id: "clans-rankings",
    feature: "predict-community",
    kind: "read",
    args: ["predictions", "clans", "rankings", "--limit", "5"],
    expect: nonEmpty("rankings"),
  },
  {
    id: "clans-invites-signed",
    feature: "predict-community",
    kind: "read",
    signer: "generated",
    args: ["predictions", "clans", "invites"],
    expect: hasKey("invites"),
  },
  {
    id: "clans-create",
    feature: "predict-community",
    kind: "read",
    args: [
      "--dry-run",
      "predictions",
      "clans",
      "create",
      "--name",
      "Parity Check",
      "--handle",
      "parity-check",
    ],
    expect: signedPreview,
  },
  {
    id: "clans-join",
    feature: "predict-community",
    kind: "read",
    args: ["--dry-run", "predictions", "clans", "join", "--clan", CLAN],
    expect: signedPreview,
  },
  {
    id: "clans-leave",
    feature: "predict-community",
    kind: "read",
    args: ["--dry-run", "predictions", "clans", "leave", "--clan", CLAN],
    expect: signedPreview,
  },
  {
    id: "comments-event",
    feature: "predict-community",
    kind: "read",
    args: [
      "predictions",
      "comments",
      "list",
      "--subcategory",
      "nfl",
      "--limit",
      "3",
    ],
    expect: hasKey("comments"),
  },
  {
    id: "comments-post",
    feature: "predict-community",
    kind: "read",
    args: [
      "--dry-run",
      "predictions",
      "comments",
      "post",
      "--event",
      POLYMARKET_EVENT,
      "--text",
      "parity check",
    ],
    expect: signedPreview,
  },
  {
    id: "comments-like",
    feature: "predict-community",
    kind: "read",
    args: [
      "--dry-run",
      "predictions",
      "comments",
      "like",
      "--comment",
      "ea245bde-92ba-4e2b-978f-b41f03416e25",
    ],
    expect: signedPreview,
  },
];

const account: ParityCase[] = [
  {
    id: "positions",
    feature: "predict-account",
    kind: "read",
    wallet: found.trader,
    args: ["predictions", "positions", "--address", WALLET],
    expect: nonEmpty("positions"),
  },
  {
    id: "history",
    feature: "predict-account",
    kind: "read",
    wallet: found.trader,
    args: ["predictions", "history", "--address", WALLET, "--limit", "3"],
    expect: nonEmpty("history"),
  },
  {
    id: "orders",
    feature: "predict-account",
    kind: "read",
    wallet: found.trader,
    args: ["predictions", "orders", "--address", WALLET],
    expect: hasKey("orders"),
  },
  {
    id: "profile",
    feature: "predict-account",
    kind: "read",
    wallet: found.trader,
    args: ["predictions", "profile", "--address", WALLET],
    expect: hasKey("volumeUsd"),
  },
  {
    id: "pnl",
    feature: "predict-account",
    kind: "read",
    wallet: found.trader,
    args: ["predictions", "pnl", "--address", WALLET, "--interval", "30d"],
    expect: nonEmpty("history"),
  },
  {
    id: "leaderboard",
    feature: "predict-account",
    kind: "read",
    args: ["predictions", "leaderboard", "--metric", "volume", "--limit", "5"],
    expect: nonEmpty("leaderboard"),
  },
  {
    id: "set-username",
    feature: "predict-account",
    kind: "read",
    args: ["--dry-run", "predictions", "set-username", "--username", "parity"],
    expect: signedPreview,
  },
  {
    id: "close-partial",
    feature: "predict-account",
    kind: "tx",
    wallet: found.trader,
    args: [
      "predictions",
      "close",
      "--position",
      found.position,
      "--contracts",
      "10",
    ],
  },
  {
    id: "close-full",
    feature: "predict-account",
    kind: "tx",
    wallet: found.trader,
    args: ["predictions", "close", "--position", found.position],
  },
  {
    id: "close-all",
    feature: "predict-account",
    kind: "tx",
    wallet: found.trader,
    args: ["predictions", "close", "--position", "all"],
  },
  found.claimer
    ? {
        id: "claim-all",
        feature: "predict-account",
        kind: "tx",
        wallet: found.claimer,
        args: ["predictions", "claim"],
      }
    : {
        id: "claim-all",
        feature: "predict-account",
        kind: "unsupported",
        reason:
          "skipped: no public wallet had a claimable position at run time",
      },
  found.limitOrder && found.limitOrderOwner
    ? {
        id: "cancel-limit",
        feature: "predict-account",
        kind: "tx",
        wallet: found.limitOrderOwner,
        args: ["predictions", "close", "--order", found.limitOrder],
      }
    : {
        id: "cancel-limit",
        feature: "predict-account",
        kind: "unsupported",
        reason:
          "skipped: no public wallet had a resting limit order at run time",
      },
];

export const cases: ParityCase[] = [
  ...feed,
  ...timed,
  ...arcade,
  ...community,
  ...account,
];
