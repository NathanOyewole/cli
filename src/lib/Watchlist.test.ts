import { describe, expect, test } from "bun:test";

import { Watchlist, type WatchlistEntry } from "./Watchlist.ts";

const BONK: WatchlistEntry = {
  kind: "token",
  id: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  symbol: "Bonk",
  addedTimestamp: 5,
};

describe("Watchlist", () => {
  test("default config matches the web's default list", () => {
    const config = Watchlist.defaultConfig();
    expect(config.activeWatchlistName).toBe("Default");
    expect(config.watchlists[0]!.entries.map((e) => e.symbol)).toEqual([
      "SOL",
      "JUP",
    ]);
  });

  test("adds to the active list once", () => {
    const first = Watchlist.add(Watchlist.defaultConfig(), BONK, undefined, 9);
    expect(first.added).toBe(true);
    const second = Watchlist.add(first.config, BONK, undefined, 9);
    expect(second.added).toBe(false);
    expect(Watchlist.get(second.config).entries).toHaveLength(3);
  });

  test("creates a named list on first add", () => {
    const { config } = Watchlist.add(
      Watchlist.defaultConfig(),
      BONK,
      "memes",
      9
    );
    expect(Watchlist.get(config, "memes")).toEqual({
      name: "memes",
      entries: [BONK],
      createdAt: 9,
    });
  });

  test("enforces name length and list count limits", () => {
    expect(() =>
      Watchlist.add(Watchlist.defaultConfig(), BONK, "a".repeat(16), 0)
    ).toThrow("at most 15 characters");
    let config = Watchlist.defaultConfig();
    for (let i = 1; i < 10; i++) {
      config = Watchlist.add(config, BONK, `list${i}`, 0).config;
    }
    expect(() => Watchlist.add(config, BONK, "list10", 0)).toThrow(
      "at most 10 watchlists"
    );
  });

  test("removes by kind and id", () => {
    const added = Watchlist.add(Watchlist.defaultConfig(), BONK, undefined, 0);
    const { config, removed } = Watchlist.remove(
      added.config,
      { kind: "token", id: BONK.id },
      undefined
    );
    expect(removed).toBe(true);
    expect(Watchlist.get(config).entries).toHaveLength(2);
  });

  test("deleting the active list switches to the first remaining", () => {
    let config = Watchlist.add(
      Watchlist.defaultConfig(),
      BONK,
      "memes",
      0
    ).config;
    config = Watchlist.use(config, "memes");
    config = Watchlist.deleteList(config, "memes");
    expect(config.activeWatchlistName).toBe("Default");
    expect(() => Watchlist.deleteList(config, "Default")).toThrow(
      "only watchlist"
    );
  });

  test("parses legacy lists stored under `tokens`", () => {
    const config = Watchlist.parse({
      watchlists: [
        {
          name: "Old",
          tokens: [{ id: "x", symbol: "X", addedTimestamp: 1 }],
          createdAt: 2,
        },
      ],
    });
    expect(config.watchlists[0]!.entries).toEqual([
      { kind: "token", id: "x", symbol: "X", addedTimestamp: 1 },
    ]);
    expect(config.activeWatchlistName).toBe("Default");
  });
});
