import { isAddress } from "@solana/kit";

import type {
  Campaign,
  CampaignApplication,
} from "../clients/RewardsClient.ts";

export type CampaignStatus =
  | "upcoming"
  | "ongoing"
  | "pending_claim"
  | "claim_only"
  | "ended";

export type CampaignStatusFilter = "all" | "live" | "ended";

// The ASR Apr-Jun 2026 claim vault was closed on-chain before its listed
// claimEndsAt, so jup.ag shows it as ended; claims now go through support.
const CLAIM_CLOSED_SLUGS = new Set(["asr-2026-q2"]);

export class RewardsCampaign {
  // jup.ag's display status: a closed claim vault or an exhausted pool shows
  // as ended.
  public static status(campaign: Campaign, now = new Date()): CampaignStatus {
    if (
      CLAIM_CLOSED_SLUGS.has(campaign.slug) ||
      this.isPoolExhausted(campaign)
    ) {
      return "ended";
    }
    return this.scheduleStatus(campaign, now);
  }

  // Mirrors jup.ag's canClaimRewards, which ignores pool exhaustion: a user can
  // still claim rewards allocated before the pool ran out. Fixed campaigns
  // without a claim end date stay claimable once claiming has started.
  public static canClaim(campaign: Campaign, now = new Date()): boolean {
    if (CLAIM_CLOSED_SLUGS.has(campaign.slug)) {
      return false;
    }
    const claimStarted =
      !campaign.claimStartsAt || now >= new Date(campaign.claimStartsAt);
    if (!claimStarted) {
      return false;
    }
    const status = this.scheduleStatus(campaign, now);
    if (status === "ongoing" || status === "claim_only") {
      return true;
    }
    return (
      campaign.reward.type === "fixed" &&
      !campaign.claimEndsAt &&
      now >= new Date(campaign.startsAt)
    );
  }

  // Campaigns flagged by jup.ag as claimable only from a Jupiter wallet.
  public static requiresJupiterWallet(campaign: Campaign): boolean {
    return campaign.reward.onlyClaimableThroughJup === true;
  }

  public static parseStatusFilter(value: string): CampaignStatusFilter {
    const normalized = value.toLowerCase();
    if (normalized === "ongoing") {
      return "live";
    }
    if (
      normalized !== "all" &&
      normalized !== "live" &&
      normalized !== "ended"
    ) {
      throw new Error("Invalid --status. Must be one of: all, live, ended.");
    }
    return normalized;
  }

  // jup.ag's "Live" tab lists every campaign that hasn't ended, including
  // upcoming and claim-only ones.
  public static matchesFilter(
    status: CampaignStatus,
    filter: CampaignStatusFilter
  ): boolean {
    if (filter === "all") {
      return true;
    }
    return filter === "ended" ? status === "ended" : status !== "ended";
  }

  public static remainingPoolUsd(campaign: Campaign): number | null {
    const pool = this.matchingPool(campaign);
    if (pool && pool.remainingPoolUsd >= 0) {
      return pool.remainingPoolUsd;
    }
    return campaign.reward.remainingPoolUsd ?? null;
  }

  public static totalPoolUsd(campaign: Campaign): number | null {
    const pool = this.matchingPool(campaign);
    if (pool && pool.totalPoolUsd >= 0) {
      return pool.totalPoolUsd;
    }
    return campaign.reward.supposedUsdValue ?? null;
  }

  public static buildApplication(opts: {
    project: string;
    token: string;
    contactMethod: string;
    contact: string;
    goals?: string;
  }): CampaignApplication {
    const projectName = opts.project.trim();
    const tokenMintAddress = opts.token.trim();
    const contactValue = opts.contact.trim();
    const contactMethod = opts.contactMethod.toLowerCase();
    const campaignGoals = opts.goals?.trim();

    if (projectName.length === 0 || projectName.length > 120) {
      throw new Error("--project must be 1-120 characters.");
    }
    if (!isAddress(tokenMintAddress)) {
      throw new Error("--token must be a valid Solana token mint address.");
    }
    if (!isContactMethod(contactMethod)) {
      throw new Error(
        "Invalid --contact-method. Must be one of: twitter, telegram, email, discord."
      );
    }
    if (contactValue.length === 0 || contactValue.length > 128) {
      throw new Error("--contact must be 1-128 characters.");
    }
    const hasControlCharacter = [...contactValue].some((c) => {
      const code = c.codePointAt(0)!;
      return code <= 31 || code === 127;
    });
    if (hasControlCharacter) {
      throw new Error(
        "--contact can't include line breaks or hidden characters."
      );
    }
    if (
      contactMethod === "email" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactValue)
    ) {
      throw new Error("--contact must be a valid email address.");
    }
    if (
      contactMethod !== "email" &&
      /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(contactValue)
    ) {
      throw new Error("--contact must be a handle, not a URL.");
    }
    if (campaignGoals && campaignGoals.length > 2000) {
      throw new Error("--goals must be 2000 characters or fewer.");
    }

    return {
      projectName,
      tokenMintAddress,
      contactMethod,
      contactValue,
      ...(campaignGoals && { campaignGoals }),
    };
  }

  private static scheduleStatus(campaign: Campaign, now: Date): CampaignStatus {
    if (now < new Date(campaign.startsAt)) {
      return "upcoming";
    }
    if (now <= new Date(campaign.endsAt)) {
      return "ongoing";
    }
    const claimStartsAt = campaign.claimStartsAt
      ? new Date(campaign.claimStartsAt)
      : undefined;
    const claimEndsAt = campaign.claimEndsAt
      ? new Date(campaign.claimEndsAt)
      : undefined;
    if (claimStartsAt && now < claimStartsAt) {
      return "pending_claim";
    }
    if (!claimEndsAt) {
      return "pending_claim";
    }
    return now <= claimEndsAt ? "claim_only" : "ended";
  }

  private static isPoolExhausted(campaign: Campaign): boolean {
    const pool = this.matchingPool(campaign);
    if (pool) {
      return pool.remainingPoolTokenAmount === 0;
    }
    return (
      campaign.reward.type === "lootbox" &&
      campaign.reward.remainingPoolUsd === 0
    );
  }

  private static matchingPool(campaign: Campaign): Campaign["rewardsPool"] {
    const pool = campaign.rewardsPool;
    return pool && pool.assetId === campaign.reward.assetId ? pool : undefined;
  }
}

const CONTACT_METHODS = ["twitter", "telegram", "email", "discord"] as const;

function isContactMethod(
  value: string
): value is CampaignApplication["contactMethod"] {
  return (CONTACT_METHODS as readonly string[]).includes(value);
}
