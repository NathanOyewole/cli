import { describe, expect, test } from "bun:test";

import type { PredictionEvent } from "../clients/PredictionsClient.ts";
import type { ArcadeRound } from "../clients/PredictionsArcadeClient.ts";
import { PredictionsExecution } from "../lib/PredictionsExecution.ts";
import { PredictionsFormat } from "../lib/PredictionsFormat.ts";
import { PredictionsArcadeCommand } from "./PredictionsArcadeCommand.ts";
import { PredictionsCommand } from "./PredictionsCommand.ts";
import { PredictionsCommunityCommand } from "./PredictionsCommunityCommand.ts";
import { PredictionsDiscoveryCommand } from "./PredictionsDiscoveryCommand.ts";

describe("partial sells", () => {
  test("snap to each venue's contract step", () => {
    expect(
      PredictionsCommand.snapContractsMicro(10_005_000n, "polymarket")
    ).toBe("10000000");
    expect(PredictionsCommand.snapContractsMicro(2_500_000n, "kalshi")).toBe(
      "2000000"
    );
    expect(PredictionsCommand.snapContractsMicro(1_234_567n, "bisonfi")).toBe(
      "1234567"
    );
    expect(PredictionsCommand.snapContractsMicro(5_000_000n, "gx")).toBe("0");
  });

  test("min sell price sits $0.02 under the bid, floored at $0.01", () => {
    expect(PredictionsCommand.minSellPriceMicro("780000")).toBe("760000");
    expect(PredictionsCommand.minSellPriceMicro("25000")).toBe("10000");
  });
});

describe("limit price", () => {
  test("converts USD to micro-USD", () => {
    expect(PredictionsCommand.parseLimitPrice("0.42")).toBe("420000");
  });

  test("rejects prices outside (0, 1)", () => {
    expect(() => PredictionsCommand.parseLimitPrice("1")).toThrow(
      "--limit must be a price per contract between 0 and 1 USD"
    );
    expect(() => PredictionsCommand.parseLimitPrice("0")).toThrow();
  });
});

describe("claimable", () => {
  test("prefers the server flag", () => {
    expect(
      PredictionsCommand.isClaimable({
        claimable: false,
        claimed: false,
        isYes: true,
        marketMetadata: { result: "yes" },
      })
    ).toBe(false);
  });

  test("falls back to the market result", () => {
    expect(
      PredictionsCommand.isClaimable({
        claimed: false,
        isYes: false,
        marketMetadata: { result: "no" },
      })
    ).toBe(true);
  });
});

describe("contracts", () => {
  test("keep the fraction the whole-contract field truncates", () => {
    expect(PredictionsFormat.contracts("660000", "0")).toBe(0.66);
    expect(PredictionsFormat.contracts("50410000", "50")).toBe(50.41);
  });

  test("fall back to whole contracts without a micro field", () => {
    expect(PredictionsFormat.contracts(undefined, "12")).toBe(12);
  });
});

describe("fill from history", () => {
  test("filled order reports contracts and price", () => {
    expect(
      PredictionsExecution.fillFromHistory([
        {
          eventType: "order_created",
          filledContracts: "0",
          filledContractsMicro: "0",
          avgFillPriceUsd: "0",
        },
        {
          eventType: "order_filled",
          filledContracts: "6",
          filledContractsMicro: "6250000",
          avgFillPriceUsd: "790000",
        },
      ])
    ).toEqual({
      orderStatus: "filled",
      filledContracts: 6.25,
      avgFillPriceUsd: 0.79,
    });
  });

  test("failed and unknown orders", () => {
    expect(
      PredictionsExecution.fillFromHistory([
        {
          eventType: "order_failed",
          filledContracts: "0",
          avgFillPriceUsd: "0",
        },
      ]).orderStatus
    ).toBe("failed");
    expect(PredictionsExecution.fillFromHistory([]).orderStatus).toBe(
      "pending"
    );
  });
});

describe("orderbook", () => {
  test("asks are the other side's bids mirrored around $1", () => {
    const book = PredictionsDiscoveryCommand.toOrderbook(
      {
        yes_dollars: [
          ["0.7600", 10],
          ["0.7800", 25],
        ],
        no_dollars: [
          ["0.1900", 5],
          ["0.2100", 7],
        ],
      },
      10
    );
    expect(book.yes).toEqual({
      bestBidUsd: 0.78,
      bestAskUsd: 0.79,
      bids: [
        { priceUsd: 0.78, contracts: 25 },
        { priceUsd: 0.76, contracts: 10 },
      ],
      asks: [
        { priceUsd: 0.79, contracts: 7 },
        { priceUsd: 0.81, contracts: 5 },
      ],
    });
    expect(book.no.bestBidUsd).toBe(0.21);
    expect(book.no.bestAskUsd).toBe(0.22);
  });
});

describe("timed events", () => {
  const event = (id: string, beginAt: number, closeAt: number) =>
    ({
      eventId: id,
      beginAt: String(beginAt),
      metadata: { closeTime: new Date(closeAt * 1000).toISOString() },
    }) as PredictionEvent;

  test("split into recent, current, and upcoming", () => {
    const { current, upcoming, recent } =
      PredictionsDiscoveryCommand.bucketTimedEvents(
        [
          event("next2", 1300, 1400),
          event("past1", 900, 1000),
          event("live", 1000, 1100),
          event("next1", 1100, 1200),
          event("past2", 800, 900),
        ],
        1050_000
      );
    expect(current?.eventId).toBe("live");
    expect(upcoming.map((e) => e.eventId)).toEqual(["next1", "next2"]);
    expect(recent.map((e) => e.eventId)).toEqual(["past1", "past2"]);
  });
});

describe("arcade", () => {
  const round = (openTs: number) =>
    ({ openTs, closeTs: openTs + 60 }) as ArcadeRound;

  test("live round holds the server time and bets go to the next", () => {
    const { live, next } = PredictionsArcadeCommand.currentRounds(
      [round(180), round(60), round(120)],
      100
    );
    expect(live?.openTs).toBe(60);
    expect(next?.openTs).toBe(120);
  });

  test("side aliases", () => {
    expect(PredictionsArcadeCommand.normalizeSide("u")).toBe("UP");
    expect(PredictionsArcadeCommand.normalizeSide("Down")).toBe("DOWN");
    expect(() => PredictionsArcadeCommand.normalizeSide("yes")).toThrow();
  });
});

describe("comment threads", () => {
  test("regular events use the subcategory alone", () => {
    expect(
      PredictionsCommunityCommand.eventThread({
        category: "sports",
        subcategory: "nfl",
        tags: ["sports", "nfl"],
        markets: [{ provider: "polymarket" }],
      })
    ).toEqual({ subcategory: "nfl", tags: [] });
  });

  test("timed crypto events add the timeframe", () => {
    expect(
      PredictionsCommunityCommand.eventThread({
        category: "crypto",
        subcategory: "btc",
        tags: ["crypto", "15m"],
        markets: [{ provider: "polymarket" }],
      })
    ).toEqual({ subcategory: "btc", tags: ["15m"] });
  });

  test("timed stock events add the series and timeframe", () => {
    expect(
      PredictionsCommunityCommand.eventThread({
        category: "finance",
        subcategory: "stocks",
        tags: ["finance", "stocks", "spcx", "5m"],
        markets: [{ provider: "bisonfi" }, { provider: "bisonfi" }],
      })
    ).toEqual({ subcategory: "stocks", tags: ["spcx", "5m"] });
  });
});
