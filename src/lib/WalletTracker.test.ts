import { describe, expect, test } from "bun:test";

import { WalletTracker } from "./WalletTracker.ts";

const A = "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue";
const B = "ETuGE3Gyj5YwsRuMRycapgfZhxJPwgqc9oYDTqR2LC8Z";
const NOW = new Date("2026-01-01T00:00:00.000Z");

describe("WalletTracker", () => {
  test("follow adds a wallet and its label", () => {
    const config = WalletTracker.follow(
      { following: [], labels: [] },
      { address: A, name: "Whale", groups: ["Main"] },
      NOW
    );
    expect(config).toEqual({
      following: [{ address: A, addedAt: "2026-01-01T00:00:00.000Z" }],
      labels: [{ address: A, name: "Whale", groups: ["Main"] }],
    });
  });

  test("follow on an existing wallet only updates its label", () => {
    const first = WalletTracker.follow(
      { following: [], labels: [] },
      { address: A, name: "Whale" },
      NOW
    );
    const second = WalletTracker.follow(
      first,
      { address: A, emoji: "🐳" },
      new Date()
    );
    expect(second.following).toEqual(first.following);
    expect(second.labels).toEqual([{ address: A, name: "Whale", emoji: "🐳" }]);
  });

  test("rejects invalid addresses and long names", () => {
    const empty = { following: [], labels: [] };
    expect(() => WalletTracker.follow(empty, { address: "nope" }, NOW)).toThrow(
      "Invalid wallet address"
    );
    expect(() =>
      WalletTracker.follow(empty, { address: A, name: "x".repeat(19) }, NOW)
    ).toThrow("at most 18");
  });

  test("parses Axiom/GMGN share JSON like the web importer", () => {
    const { wallets, skipped } = WalletTracker.parseShared(
      [
        {
          trackedWalletAddress: A,
          name: " Whale ",
          emoji: "🐳",
          groups: ["Default"],
          sound: "kaching",
          alertsOnToast: true,
        },
        { address: B, emoji: "👻", sound: "unknown" },
        { address: "bad" },
      ],
      NOW
    );
    expect(skipped).toBe(1);
    expect(wallets).toEqual([
      {
        address: A,
        addedAt: "2026-01-01T00:00:00.000Z",
        name: "Whale",
        emoji: "🐳",
        groups: ["Main"],
        sound: "ka-ching",
        toast: true,
      },
      {
        address: B,
        addedAt: "2026-01-01T00:00:00.000Z",
        name: "",
        emoji: undefined,
        groups: undefined,
        sound: "bell",
        toast: false,
      },
    ]);
  });

  test("merge keeps the newest 50 wallets", () => {
    const following = Array.from({ length: 50 }, (_, i) => ({
      address: `w${i}`,
      addedAt: new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString(),
    }));
    const merged = WalletTracker.merge({ following, labels: [] }, [
      { address: A, addedAt: NOW.toISOString(), name: "New" },
    ]);
    expect(merged.following).toHaveLength(50);
    expect(merged.following[0]!.address).toBe("w1");
    expect(merged.following.at(-1)!.address).toBe(A);
    expect(merged.labels).toEqual([{ address: A, name: "New" }]);
  });

  test("exports the web's Axiom-compatible share format", () => {
    const config = WalletTracker.follow(
      { following: [], labels: [] },
      { address: A, name: "Whale" },
      NOW
    );
    expect(WalletTracker.toShared(config)).toEqual([
      {
        address: A,
        name: "Whale",
        emoji: undefined,
        alertsOnToast: true,
        alertsOnBubble: true,
        alertsOnFeed: true,
        groups: [],
        sound: undefined,
      },
    ]);
  });
});
