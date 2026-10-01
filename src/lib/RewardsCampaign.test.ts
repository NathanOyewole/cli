import { describe, expect, test } from "bun:test";

import type { Campaign } from "../clients/RewardsClient.ts";
import { RewardsCampaign } from "./RewardsCampaign.ts";

function campaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "c1",
    slug: "test",
    title: "Test",
    startsAt: "2026-01-10T00:00:00.000Z",
    endsAt: "2026-01-20T00:00:00.000Z",
    claimStartsAt: "2026-01-25T00:00:00.000Z",
    claimEndsAt: "2026-01-30T00:00:00.000Z",
    uiTemplate: "retroactive",
    reward: { type: "retroactive", assetId: "JUP" },
    rewardsPool: null,
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

describe("RewardsCampaign.status", () => {
  test("walks the campaign lifecycle by date", () => {
    const c = campaign();
    expect(RewardsCampaign.status(c, at("2026-01-05T00:00:00Z"))).toBe(
      "upcoming"
    );
    expect(RewardsCampaign.status(c, at("2026-01-15T00:00:00Z"))).toBe(
      "ongoing"
    );
    expect(RewardsCampaign.status(c, at("2026-01-22T00:00:00Z"))).toBe(
      "pending_claim"
    );
    expect(RewardsCampaign.status(c, at("2026-01-27T00:00:00Z"))).toBe(
      "claim_only"
    );
    expect(RewardsCampaign.status(c, at("2026-02-01T00:00:00Z"))).toBe("ended");
  });

  test("stays pending_claim after the campaign when no claim end is set", () => {
    const c = campaign({ claimStartsAt: null, claimEndsAt: null });
    expect(RewardsCampaign.status(c, at("2026-03-01T00:00:00Z"))).toBe(
      "pending_claim"
    );
  });

  test("treats an exhausted matching pool as ended", () => {
    const c = campaign({
      rewardsPool: {
        assetId: "JUP",
        totalPoolUsd: 100,
        totalPoolTokenAmount: 100,
        totalClaimedUsd: 100,
        totalClaimedTokenAmount: 100,
        remainingPoolUsd: 0,
        remainingPoolTokenAmount: 0,
      },
    });
    expect(RewardsCampaign.status(c, at("2026-01-15T00:00:00Z"))).toBe("ended");
  });

  test("ends asr-2026-q2 regardless of its claim window", () => {
    const c = campaign({ slug: "asr-2026-q2" });
    expect(RewardsCampaign.status(c, at("2026-01-27T00:00:00Z"))).toBe("ended");
    expect(RewardsCampaign.canClaim(c, at("2026-01-27T00:00:00Z"))).toBe(false);
  });
});

describe("RewardsCampaign.canClaim", () => {
  test("allows claims only once the claim window has opened", () => {
    const c = campaign();
    expect(RewardsCampaign.canClaim(c, at("2026-01-15T00:00:00Z"))).toBe(false);
    expect(RewardsCampaign.canClaim(c, at("2026-01-27T00:00:00Z"))).toBe(true);
    expect(RewardsCampaign.canClaim(c, at("2026-02-01T00:00:00Z"))).toBe(false);
  });

  test("still allows claims when the pool is exhausted", () => {
    const c = campaign({
      rewardsPool: {
        assetId: "JUP",
        totalPoolUsd: 100,
        totalPoolTokenAmount: 100,
        totalClaimedUsd: 100,
        totalClaimedTokenAmount: 100,
        remainingPoolUsd: 0,
        remainingPoolTokenAmount: 0,
      },
    });
    expect(RewardsCampaign.status(c, at("2026-01-27T00:00:00Z"))).toBe("ended");
    expect(RewardsCampaign.canClaim(c, at("2026-01-27T00:00:00Z"))).toBe(true);
  });

  test("keeps fixed campaigns without a claim end claimable", () => {
    const fixed = campaign({
      reward: { type: "fixed", assetId: "JUP" },
      claimEndsAt: null,
    });
    expect(RewardsCampaign.canClaim(fixed, at("2026-01-22T00:00:00Z"))).toBe(
      false
    );
    expect(RewardsCampaign.canClaim(fixed, at("2026-01-27T00:00:00Z"))).toBe(
      true
    );
    expect(RewardsCampaign.canClaim(fixed, at("2027-01-01T00:00:00Z"))).toBe(
      true
    );

    const other = campaign({ claimEndsAt: null });
    expect(RewardsCampaign.canClaim(other, at("2026-01-27T00:00:00Z"))).toBe(
      false
    );
  });
});

describe("RewardsCampaign.requiresJupiterWallet", () => {
  test("reads the reward's onlyClaimableThroughJup flag", () => {
    expect(
      RewardsCampaign.requiresJupiterWallet(
        campaign({
          reward: { type: "token", onlyClaimableThroughJup: true },
        })
      )
    ).toBe(true);
    expect(RewardsCampaign.requiresJupiterWallet(campaign())).toBe(false);
  });
});

describe("RewardsCampaign status filter", () => {
  test("parses filters and accepts ongoing as live", () => {
    expect(RewardsCampaign.parseStatusFilter("ALL")).toBe("all");
    expect(RewardsCampaign.parseStatusFilter("ongoing")).toBe("live");
    expect(() => RewardsCampaign.parseStatusFilter("soon")).toThrow(
      "Invalid --status. Must be one of: all, live, ended."
    );
  });

  test("live keeps every status except ended", () => {
    expect(RewardsCampaign.matchesFilter("claim_only", "live")).toBe(true);
    expect(RewardsCampaign.matchesFilter("upcoming", "live")).toBe(true);
    expect(RewardsCampaign.matchesFilter("ended", "live")).toBe(false);
    expect(RewardsCampaign.matchesFilter("ended", "ended")).toBe(true);
    expect(RewardsCampaign.matchesFilter("ongoing", "ended")).toBe(false);
  });
});

describe("RewardsCampaign.buildApplication", () => {
  const base = {
    project: "  My Project ",
    token: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    contactMethod: "Twitter",
    contact: "@builder",
  };

  test("trims fields and omits empty goals", () => {
    expect(RewardsCampaign.buildApplication({ ...base, goals: " " })).toEqual({
      projectName: "My Project",
      tokenMintAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      contactMethod: "twitter",
      contactValue: "@builder",
    });
  });

  test("rejects invalid input the way the web form does", () => {
    expect(() =>
      RewardsCampaign.buildApplication({ ...base, token: "not-a-mint" })
    ).toThrow("--token must be a valid Solana token mint address.");
    expect(() =>
      RewardsCampaign.buildApplication({ ...base, contactMethod: "fax" })
    ).toThrow("Invalid --contact-method.");
    expect(() =>
      RewardsCampaign.buildApplication({
        ...base,
        contact: "https://x.com/builder",
      })
    ).toThrow("--contact must be a handle, not a URL.");
    expect(() =>
      RewardsCampaign.buildApplication({
        ...base,
        contactMethod: "email",
        contact: "builder@",
      })
    ).toThrow("--contact must be a valid email address.");
    expect(() =>
      RewardsCampaign.buildApplication({ ...base, contact: "a\nb" })
    ).toThrow("--contact can't include line breaks or hidden characters.");
  });
});
