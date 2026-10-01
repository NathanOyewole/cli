import chalk from "chalk";
import type { Command } from "commander";

import {
  PredictionsClient,
  type PredictionEvent,
  type Subcategory,
} from "../clients/PredictionsClient.ts";
import {
  PredictionsPriceClient,
  type OrderbookSnapshot,
} from "../clients/PredictionsPriceClient.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PredictionsFormat, type EventJson } from "../lib/PredictionsFormat.ts";

const TIMED_ASSETS = [
  "btc",
  "eth",
  "sol",
  "xrp",
  "bnb",
  "doge",
  "hype",
  "spcx",
];
const TIMED_INTERVALS = [
  "5m",
  "15m",
  "1H",
  "4h",
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

type BookLevel = { priceUsd: number; contracts: number };
type BookSide = {
  bestBidUsd: number | null;
  bestAskUsd: number | null;
  bids: BookLevel[];
  asks: BookLevel[];
};

export class PredictionsDiscoveryCommand {
  public static register(predictions: Command): void {
    predictions
      .command("categories")
      .description("List event categories, subcategories, and tags")
      .option("--category <category>", "Show one category and its tags")
      .action((opts) => this.categories(opts));
    predictions
      .command("suggested")
      .description("Suggested events")
      .option("--category <category>", "Limit to a category")
      .option("--exclude <eventId>", "Event to exclude (e.g. the one viewed)")
      .option("--limit <n>", "Max results", "5")
      .action((opts) => this.suggested(opts));
    predictions
      .command("market")
      .description("Look up a single market's prices and rules")
      .requiredOption("--id <marketId>", "Market ID")
      .action((opts) => this.market(opts));
    predictions
      .command("timed")
      .description("Timed up/down markets for crypto and stocks")
      .requiredOption("--asset <asset>", `Asset: ${TIMED_ASSETS.join(", ")}`)
      .option(
        "--interval <interval>",
        `Interval: ${TIMED_INTERVALS.join(", ")}`,
        "15m"
      )
      .option("--limit <n>", "Upcoming and recent events to show", "3")
      .action((opts) => this.timed(opts));
    predictions
      .command("score")
      .description("Live score for a sports event")
      .requiredOption("--event <eventId>", "Event ID")
      .action((opts) => this.score(opts));
    predictions
      .command("price-history")
      .description("Implied probability history for a market")
      .requiredOption("--market <marketId>", "Market ID")
      .option("--limit <n>", "Most recent points to show", "50")
      .action((opts) => this.priceHistory(opts));
    predictions
      .command("trades")
      .description("Latest trades across all prediction markets")
      .option("--limit <n>", "Max results", "20")
      .action((opts) => this.trades(opts));
    predictions
      .command("orderbook")
      .description("Orderbook snapshot for a market")
      .requiredOption("--market <marketId>", "Market ID")
      .option("--depth <n>", "Price levels per side", "10")
      .action((opts) => this.orderbook(opts));
  }

  private static async categories(opts: { category?: string }): Promise<void> {
    const res = await PredictionsClient.getCategories();
    const toJson = (s: Subcategory): Record<string, unknown> => ({
      subcategory: s.subcategory,
      label: s.label,
      eventCount: s.eventCount,
      ...(s.children?.length && { children: s.children.map(toJson) }),
    });
    const categories = res.data
      .filter((c) => !opts.category || c.category === opts.category)
      .map((c) => ({
        category: c.category,
        eventCount: c.eventCount,
        subcategories: c.subcategories.map(toJson),
      }));
    if (opts.category && categories.length === 0) {
      throw new Error(
        `Unknown category "${opts.category}". Options: ${res.data.map((c) => c.category).join(", ")}.`
      );
    }
    const tags = opts.category
      ? (await PredictionsClient.getTags(opts.category)).data
      : undefined;

    if (Output.isJson()) {
      Output.json({ categories, ...(tags && { tags }) });
      return;
    }

    const rows: Record<string, unknown>[] = [];
    for (const c of res.data.filter(
      (c) => !opts.category || c.category === opts.category
    )) {
      rows.push({
        name: chalk.bold(c.category),
        id: c.category,
        count: c.eventCount,
      });
      const walk = (subs: Subcategory[], depth: number) => {
        for (const s of subs) {
          rows.push({
            name: `${"  ".repeat(depth)}${s.label}`,
            id: s.subcategory,
            count: s.eventCount,
          });
          walk(s.children ?? [], depth + 1);
        }
      };
      walk(c.subcategories, 1);
    }
    Output.table({
      type: "horizontal",
      headers: { name: "Category", id: "Subcategory", count: "Events" },
      rows,
    });
    if (tags) {
      Output.table({
        type: "horizontal",
        headers: { label: "Tag", tag: "ID", eventCount: "Events" },
        rows: tags,
      });
    }
  }

  private static async suggested(opts: {
    category?: string;
    exclude?: string;
    limit: string;
  }): Promise<void> {
    const res = await PredictionsClient.getSuggestedEvents({
      category: opts.category,
      excludedEventId: opts.exclude,
      limit: Number(opts.limit),
    });
    const events = res.data.map((e) => PredictionsFormat.toEventJson(e));
    if (Output.isJson()) {
      Output.json({ events });
      return;
    }
    PredictionsFormat.printEvents(events);
  }

  private static async market(opts: { id: string }): Promise<void> {
    const m = await PredictionsClient.getMarket(opts.id);
    const market = {
      marketId: m.marketId,
      title: m.title,
      provider: m.provider ?? null,
      status: m.status,
      result: m.result,
      yesPriceUsd: PredictionsFormat.priceOrNull(m.pricing?.buyYesPriceUsd),
      noPriceUsd: PredictionsFormat.priceOrNull(m.pricing?.buyNoPriceUsd),
      yesSellPriceUsd: PredictionsFormat.priceOrNull(
        m.pricing?.sellYesPriceUsd
      ),
      noSellPriceUsd: PredictionsFormat.priceOrNull(m.pricing?.sellNoPriceUsd),
      options: m.marketOptions ?? null,
      limitOrders: m.provider === "polymarket",
      opensAt: PredictionsFormat.unixToIso(m.openTime),
      closesAt: PredictionsFormat.unixToIso(m.closeTime),
      resolvesAt: PredictionsFormat.unixToIso(m.resolveAt),
      rulesPrimary: m.rulesPrimary,
      rulesSecondary: m.rulesSecondary,
    };

    if (Output.isJson()) {
      Output.json(market);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Market", value: market.title },
        { label: "Market ID", value: market.marketId },
        { label: "Venue", value: market.provider ?? "—" },
        {
          label: "Status",
          value: market.status + (market.result ? ` (${market.result})` : ""),
        },
        {
          label: "Buy Yes / No",
          value: `${PredictionsFormat.formatPricePct(market.yesPriceUsd)} / ${PredictionsFormat.formatPricePct(market.noPriceUsd)}`,
        },
        {
          label: "Sell Yes / No",
          value: `${PredictionsFormat.formatPricePct(market.yesSellPriceUsd)} / ${PredictionsFormat.formatPricePct(market.noSellPriceUsd)}`,
        },
        {
          label: "Limit Orders",
          value: Output.formatBoolean(market.limitOrders),
        },
        {
          label: "Closes",
          value: market.closesAt
            ? PredictionsFormat.formatDateTime(market.closesAt)
            : "—",
        },
      ],
    });
    console.log(`\n${market.rulesPrimary}`);
    if (market.rulesSecondary) {
      console.log(chalk.gray(`\n${market.rulesSecondary}`));
    }
  }

  private static normalizeInterval(interval: string): string {
    const match = TIMED_INTERVALS.find(
      (i) => i.toLowerCase() === interval.toLowerCase()
    );
    if (!match) {
      throw new Error(
        `Invalid --interval. Must be one of: ${TIMED_INTERVALS.join(", ")}.`
      );
    }
    return match;
  }

  /** Splits timed events the way the web app does: by begin time and close time. */
  public static bucketTimedEvents(
    events: PredictionEvent[],
    nowMs: number
  ): {
    current: PredictionEvent | null;
    upcoming: PredictionEvent[];
    recent: PredictionEvent[];
  } {
    let current: PredictionEvent | null = null;
    const upcoming: PredictionEvent[] = [];
    const recent: PredictionEvent[] = [];
    for (const e of events) {
      const closeMs = e.metadata.closeTime
        ? new Date(e.metadata.closeTime).getTime()
        : null;
      const beginMs = e.beginAt ? Number(e.beginAt) * 1000 : null;
      if (closeMs && closeMs <= nowMs) {
        recent.push(e);
      } else if (beginMs && beginMs <= nowMs && closeMs && closeMs > nowMs) {
        current = e;
      } else if (beginMs && beginMs > nowMs) {
        upcoming.push(e);
      }
    }
    upcoming.sort((a, b) => Number(a.beginAt) - Number(b.beginAt));
    recent.sort((a, b) => Number(b.beginAt) - Number(a.beginAt));
    return { current, upcoming, recent };
  }

  private static async timed(opts: {
    asset: string;
    interval: string;
    limit: string;
  }): Promise<void> {
    const asset = opts.asset.toLowerCase();
    if (!TIMED_ASSETS.includes(asset)) {
      throw new Error(
        `Invalid --asset. Must be one of: ${TIMED_ASSETS.join(", ")}.`
      );
    }
    const interval = this.normalizeInterval(opts.interval);
    const isStock = asset === "spcx";
    const res = await PredictionsClient.getTimedEvents(
      isStock
        ? {
            category: "finance",
            subcategory: "stocks",
            tags: `spcx,${interval}`,
            provider: "bisonfi",
          }
        : { subcategory: asset, tags: interval }
    );
    const limit = Number(opts.limit);
    const buckets = this.bucketTimedEvents(res.data, Date.now());
    const priceToBeatUsd = buckets.current?.beginAt
      ? await PredictionsPriceClient.getCryptoPrice(
          isStock ? "spcxusd" : `${asset}usdt`,
          Number(buckets.current.beginAt)
        )
          .then((p) => p.value)
          .catch(() => null)
      : null;

    const json = {
      asset,
      interval,
      priceToBeatUsd,
      current: buckets.current
        ? PredictionsFormat.toEventJson(buckets.current)
        : null,
      upcoming: buckets.upcoming
        .slice(0, limit)
        .map((e) => PredictionsFormat.toEventJson(e)),
      recent: buckets.recent
        .slice(0, limit)
        .map((e) => PredictionsFormat.toEventJson(e)),
    };

    if (Output.isJson()) {
      Output.json(json);
      return;
    }

    const window = (e: EventJson) =>
      `${e.startsAt ? PredictionsFormat.formatDateTime(e.startsAt) : "?"} → ${e.endsAt ? new Date(e.endsAt).toLocaleTimeString() : "?"}`;
    if (json.current) {
      console.log(chalk.bold("Live: ") + json.current.title);
      console.log(chalk.gray(window(json.current)));
      if (priceToBeatUsd) {
        console.log(
          `Price to beat: ${Output.formatDollar(priceToBeatUsd, { decimals: 2 })}`
        );
      }
      Output.table({
        type: "horizontal",
        headers: { title: "Outcome", yes: "Price", marketId: "Market ID" },
        rows: json.current.markets.map((m) => ({
          title: m.title,
          yes: PredictionsFormat.formatPricePct(m.yesPriceUsd),
          marketId: m.marketId,
        })),
      });
    } else {
      console.log("No live event right now.");
    }
    const listRows = (events: EventJson[], withResult: boolean) =>
      events.map((e) => ({
        title: e.title,
        window: window(e),
        result: withResult
          ? (e.markets.find((m) => m.result === "yes")?.title ?? "—")
          : e.markets.map((m) => `${m.title}: ${m.marketId}`).join("\n"),
      }));
    if (json.upcoming.length > 0) {
      console.log(chalk.bold("\nUpcoming"));
      Output.table({
        type: "horizontal",
        headers: { title: "Event", window: "Window", result: "Markets" },
        rows: listRows(json.upcoming, false),
      });
    }
    if (json.recent.length > 0) {
      console.log(chalk.bold("\nRecent"));
      Output.table({
        type: "horizontal",
        headers: { title: "Event", window: "Window", result: "Result" },
        rows: listRows(json.recent, true),
      });
    }
  }

  private static async score(opts: { event: string }): Promise<void> {
    const s = await PredictionsClient.getEventScore(opts.event);
    const score = s
      ? {
          eventId: opts.event,
          league: s.leagueAbbreviation,
          homeTeam: s.homeTeam,
          awayTeam: s.awayTeam,
          score: s.score,
          period: s.period,
          elapsed: s.elapsed,
          status: s.status,
          live: s.live,
          ended: s.ended,
        }
      : null;

    if (Output.isJson()) {
      Output.json({ eventId: opts.event, score });
      return;
    }
    if (!score) {
      console.log("No live score for this event.");
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Match",
          value: `${score.homeTeam ?? "?"} vs ${score.awayTeam ?? "?"}`,
        },
        { label: "Score", value: score.score ?? "—" },
        { label: "Period", value: score.period ?? "—" },
        { label: "Elapsed", value: score.elapsed ?? "—" },
        { label: "Live", value: Output.formatBoolean(score.live) },
        { label: "Ended", value: Output.formatBoolean(score.ended) },
      ],
    });
  }

  private static async priceHistory(opts: {
    market: string;
    limit: string;
  }): Promise<void> {
    const res = await PredictionsClient.getForecast(opts.market);
    const history = res.forecast_history
      .map((h) => ({
        time: new Date(h.end_period_ts * 1000).toISOString(),
        probabilityPct: h.numerical_forecast,
      }))
      .slice(-Number(opts.limit));

    if (Output.isJson()) {
      Output.json({ marketId: opts.market, history });
      return;
    }
    if (history.length === 0) {
      console.log("No price history for this market.");
      return;
    }
    Output.table({
      type: "horizontal",
      headers: { time: "Time", probability: "Yes Probability" },
      rows: history.map((h) => ({
        time: PredictionsFormat.formatDateTime(h.time),
        probability: `${h.probabilityPct.toFixed(1)}%`,
      })),
    });
  }

  private static async trades(opts: { limit: string }): Promise<void> {
    const res = await PredictionsClient.getTrades();
    const trades = res.data.slice(0, Number(opts.limit)).map((t) => ({
      time: new Date(t.timestamp * 1000).toISOString(),
      address: t.ownerPubkey,
      event: t.eventTitle,
      market: t.marketTitle,
      eventId: t.eventId,
      marketId: t.marketId,
      action: t.action,
      side: t.side,
      amountUsd: NumberConverter.fromMicroUsd(t.amountUsd),
      priceUsd: NumberConverter.fromMicroUsd(t.priceUsd),
    }));

    if (Output.isJson()) {
      Output.json({ count: trades.length, trades });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        trader: "Trader",
        event: "Event / Market",
        trade: "Trade",
        price: "Price",
        amount: "Amount",
      },
      maxWidths: { event: 40 },
      rows: trades.map((t) => ({
        time: new Date(t.time).toLocaleTimeString(),
        trader: `${t.address.slice(0, 4)}…${t.address.slice(-4)}`,
        event: t.event + chalk.gray("\n└─► ") + t.market,
        trade: `${t.action} ${PredictionsFormat.formatSide(t.side)}`,
        price: Output.formatDollar(t.priceUsd, { decimals: 2 }),
        amount: Output.formatDollar(t.amountUsd, { decimals: 2 }),
      })),
    });
  }

  /** Bids on one side are the other side's bids mirrored around $1. */
  public static toOrderbook(
    snapshot: Pick<OrderbookSnapshot, "yes_dollars" | "no_dollars">,
    depth: number
  ): { yes: BookSide; no: BookSide } {
    const levels = (
      entries: [string, number][] | null,
      complement: boolean
    ): BookLevel[] =>
      (entries ?? [])
        .map(([price, contracts]) => ({
          priceUsd: Number(
            (complement ? 1 - Number(price) : Number(price)).toFixed(4)
          ),
          contracts,
        }))
        .reverse()
        .slice(0, depth);
    const side = (bids: BookLevel[], asks: BookLevel[]): BookSide => ({
      bestBidUsd: bids[0]?.priceUsd ?? null,
      bestAskUsd: asks[0]?.priceUsd ?? null,
      bids,
      asks,
    });
    return {
      yes: side(
        levels(snapshot.yes_dollars, false),
        levels(snapshot.no_dollars, true)
      ),
      no: side(
        levels(snapshot.no_dollars, false),
        levels(snapshot.yes_dollars, true)
      ),
    };
  }

  private static async orderbook(opts: {
    market: string;
    depth: string;
  }): Promise<void> {
    const snapshot = await PredictionsPriceClient.getOrderbook(opts.market);
    const book = this.toOrderbook(snapshot, Number(opts.depth));

    if (Output.isJson()) {
      Output.json({ marketId: opts.market, ...book });
      return;
    }
    for (const [label, side] of [
      ["Yes", book.yes],
      ["No", book.no],
    ] as const) {
      console.log(chalk.bold(`${label} orderbook`));
      const rows = Array.from(
        { length: Math.max(side.bids.length, side.asks.length) },
        (_, i) => ({
          bidSize: side.bids[i]?.contracts.toLocaleString() ?? "",
          bid: side.bids[i]
            ? chalk.green(`${(side.bids[i]!.priceUsd * 100).toFixed(1)}¢`)
            : "",
          ask: side.asks[i]
            ? chalk.red(`${(side.asks[i]!.priceUsd * 100).toFixed(1)}¢`)
            : "",
          askSize: side.asks[i]?.contracts.toLocaleString() ?? "",
        })
      );
      Output.table({
        type: "horizontal",
        headers: {
          bidSize: "Bid Size",
          bid: "Bid",
          ask: "Ask",
          askSize: "Ask Size",
        },
        rows,
      });
    }
  }
}
