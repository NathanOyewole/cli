import { describe, expect, test } from "bun:test";

import type { Machine, MarketplaceCard } from "../clients/GachaClient.ts";
import { Gacha } from "./Gacha.ts";

describe("Gacha.parseTransactions", () => {
  test("accepts every marketplace response shape", () => {
    expect(Gacha.parseTransactions("AQID")).toEqual(["AQID"]);
    expect(Gacha.parseTransactions('"AQID"')).toEqual(["AQID"]);
    expect(Gacha.parseTransactions('{"transaction":"AQID"}')).toEqual(["AQID"]);
    expect(Gacha.parseTransactions('{"transactions":["AQ","ID"]}')).toEqual([
      "AQ",
      "ID",
    ]);
    expect(Gacha.parseTransactions('{"message":"nope"}')).toEqual([]);
  });
});

describe("Gacha.listing", () => {
  const card: MarketplaceCard = {
    id: "2026090221C240266",
    itemName: "2022 #265 Pikachu Vmax PSA 8",
    nftAddress: "D5i9HJe3Rj12TEcUwG9X4MUMKahWxQ3TsLFcLsrFysoS",
    category: "Pokemon",
    grade: "NM-MT 8",
    gradingCompany: "PSA",
    insuredValue: "28",
    listing: {
      price: 28,
      currency: "USDC",
      createdAt: "2026-09-28T05:07:07.456Z",
      marketplace: "CC",
    },
    owner: { wallet: "ERp9c1dq71fngTkWSdLkhLnjS1SmY6V1DA5zpk75AHhm" },
  };

  test("maps a listed card", () => {
    expect(Gacha.listing(card)).toEqual({
      mint: "D5i9HJe3Rj12TEcUwG9X4MUMKahWxQ3TsLFcLsrFysoS",
      cardId: "2026090221C240266",
      name: "2022 #265 Pikachu Vmax PSA 8",
      category: "Pokemon",
      grade: "PSA NM-MT 8",
      insuredValueUsd: 28,
      status: "listed",
      price: 28,
      currency: "USDC",
      marketplace: "CC",
      owner: "ERp9c1dq71fngTkWSdLkhLnjS1SmY6V1DA5zpk75AHhm",
      listedAt: "2026-09-28T05:07:07.456Z",
    });
  });

  test("marks unlisted and shipping cards", () => {
    expect(Gacha.listing({ ...card, listing: null }).status).toBe("unlisted");
    expect(Gacha.listing({ ...card, listing: null }).price).toBe(null);
    expect(Gacha.listing({ ...card, burnId: "b1" }).status).toBe("shipping");
  });

  test("defaults Magic Eden listings without a currency to SOL", () => {
    expect(Gacha.listingCurrency(undefined, "ME")).toBe("SOL");
    expect(Gacha.listingCurrency("wsol", "CC")).toBe("SOL");
    expect(Gacha.listingCurrency(undefined, "CC")).toBe("USDC");
  });
});

describe("Gacha pack mapping", () => {
  const machine: Machine = {
    code: "pokemon_50",
    name: "Elite Pokémon Gacha Pack",
    priceNumber: 50,
    evNumber: 54.77,
    odds: { common: 0.8, uncommon: 0.15, rare: 0.04, epic: 0.01 },
    stock: { common: 0, uncommon: 3, rare: 0, epic: 0 },
    tierRanges: { common: { start: 30, end: 60 } },
    contains: 1,
    instantBuybackNumber: 85,
    metadata: { public: true, menuCategory: "Pokemon", turboMode: true },
  };

  test("summarizes a machine", () => {
    expect(Gacha.packSummary(machine)).toEqual({
      pack: "pokemon_50",
      name: "Elite Pokémon Gacha Pack",
      category: "Pokemon",
      priceUsd: 50,
      evUsd: 54.77,
      buybackPct: 85,
      cardsPerPack: 1,
      turbo: true,
      inStock: true,
    });
  });

  test("turns odds fractions into percentages", () => {
    expect(Gacha.packTiers(machine).slice(0, 2)).toEqual([
      {
        rarity: "common",
        oddsPct: 80,
        minValueUsd: 30,
        maxValueUsd: 60,
        stock: 0,
      },
      {
        rarity: "uncommon",
        oddsPct: 15,
        minValueUsd: null,
        maxValueUsd: null,
        stock: 3,
      },
    ]);
  });

  test("reads card value and grade from attributes", () => {
    expect(
      Gacha.nftCard({
        id: "mint1",
        name: "Garchomp",
        rarity: "epic",
        attributes: [
          { trait_type: "Grading Company", value: "PSA" },
          { trait_type: "The Grade", value: "MINT 9" },
          { trait_type: "Insured Value", value: "3900" },
        ],
      })
    ).toEqual({
      mint: "mint1",
      name: "Garchomp",
      rarity: "epic",
      grade: "PSA MINT 9",
      valueUsd: 3900,
    });
  });
});

describe("Gacha.trade", () => {
  test("reads the USDC price and signature", () => {
    expect(
      Gacha.trade({
        action: "buyNow",
        priceInfo: { splPrice: { rawAmount: "28000000", decimals: 6 } },
        createdAt: 1790589482,
        card: { id: "c", itemName: "Keldeo", nftAddress: "mint1" },
        from: { wallet: "seller" },
        to: { wallet: "buyer" },
        transactionUrl: "https://solscan.io/tx/5sig?cluster=mainnet",
      })
    ).toEqual({
      action: "buyNow",
      mint: "mint1",
      name: "Keldeo",
      priceUsd: 28,
      from: "seller",
      to: "buyer",
      signature: "5sig",
      at: "2026-09-28T09:58:02.000Z",
    });
  });
});

describe("Gacha.coerceList", () => {
  test("unwraps known list envelopes", () => {
    expect(Gacha.coerceList([1])).toEqual([1]);
    expect(Gacha.coerceList({ shipments: [2] })).toEqual([2]);
    expect(Gacha.coerceList({ other: [3] })).toEqual([]);
  });
});
