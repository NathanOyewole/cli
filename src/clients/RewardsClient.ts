import { ClientConfig } from "./ClientConfig.ts";

export type CampaignReward = {
  type: string;
  assetId?: string;
  rewardName?: string;
  redirectUrl?: string;
  supposedUsdValue?: number;
  remainingPoolUsd?: number;
  threshold?: number;
  max?: number;
  [key: string]: unknown;
};

export type CampaignPool = {
  assetId: string;
  totalPoolUsd: number;
  totalPoolTokenAmount: number;
  totalClaimedUsd: number;
  totalClaimedTokenAmount: number;
  remainingPoolUsd: number;
  remainingPoolTokenAmount: number;
};

export type VolumeLeaderboardPeriod = {
  id: string;
  topN?: number;
  reward?: number;
  startTime?: string;
  endTime?: string;
};

export type Campaign = {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  claimStartsAt?: string | null;
  claimEndsAt?: string | null;
  uiTemplate: string;
  reward: CampaignReward;
  rewardsPool?: CampaignPool | null;
  datapoints?: {
    hasLeaderboard?: boolean;
    event?: {
      type?: string;
      periods?: VolumeLeaderboardPeriod[];
      total?: VolumeLeaderboardPeriod;
    };
  } | null;
};

export type CampaignStats = {
  rewardType: string;
  assetId?: string;
  rank?: number;
  rankPct?: number;
  openedBoxes?: number;
  unopenedBoxes?: number;
  selfBoxes?: number;
  referralBoxes?: number;
  progressPct?: number;
  threshold?: number;
  earningsUsd?: number;
  numEntries?: number;
  eligibleVolume?: number;
  eligibleBalance?: number;
  unclaimedAmount?: number;
  claimedAmount?: number;
  stats?: {
    id: string;
    startTime: string;
    endTime: string;
    rank: number | null;
    points: number;
    multiplier: number;
    prize: number;
  }[];
  updatedAt?: string;
};

export type EarningsEntry = {
  rank: number;
  address: string;
  openedBoxes?: number;
  earningsUsd?: number;
  amount?: number;
  numEntries?: number;
};

export type EarningsResponse = {
  rewardType: string;
  earnings: EarningsEntry[];
  totalEntries?: number;
};

export type TeamLeaderboardResponse = {
  teams: {
    name: string;
    assetId: string;
    leaderboard: { rank: number; address: string; volumeUsd: number }[];
    viewer: { rank: number; address: string; volumeUsd: number } | null;
  }[];
  bonus?: {
    minVolumeUsd: number;
    prizePoolUsd: number;
    winnerCount: number;
  };
};

export type VolumeLeaderboardResponse = {
  type: "volume-leaderboard";
  period: VolumeLeaderboardPeriod;
  reward: number;
  leaderboard: {
    rank: number;
    address: string;
    points: number;
    multiplier: number;
    prize: number;
  }[];
};

export type TotalClaimsResponse = {
  totalUsd: number;
  totalReferralUsd: number;
  unclaimedRewards: (
    | {
        type: "lootbox";
        campaignTitle: string;
        campaignSlug: string;
        unopenedBoxes: number;
      }
    | {
        type: "token";
        campaignTitle: string;
        campaignSlug: string;
        tokenAddress: string;
        tokenSymbol: string;
        uiAmount: string;
        usdValue: number;
      }
  )[];
};

export type PostClaimResponse = {
  rewardType: string;
  transactionId: string;
  totalUsdValue: number;
  claimedAmount?: number;
  assetId?: string;
  claimedRewards?: {
    amount: number;
    uiAmount: number;
    usdValue: number;
    assetId: string;
  }[];
  openedBoxes?: number;
  unopenedBoxes?: number;
};

export type CampaignApplication = {
  projectName: string;
  tokenMintAddress: string;
  contactMethod: "twitter" | "telegram" | "email" | "discord";
  contactValue: string;
  campaignGoals?: string;
};

export class RewardsClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://datapi.jup.ag/rewards/v1",
  });

  static readonly #remoteKy = ClientConfig.ky.extend({
    prefixUrl: "https://remote-api.jup.ag/public",
  });

  public static async getCampaigns(): Promise<{ campaigns: Campaign[] }> {
    return this.#ky.get("campaigns").json();
  }

  public static async getCampaign(slug: string): Promise<Campaign> {
    const res = await this.#ky
      .get(`campaigns/${encodeURIComponent(slug)}`)
      .json<{ campaign: Campaign }>();
    return res.campaign;
  }

  public static async getStats(
    slug: string,
    address: string
  ): Promise<CampaignStats> {
    return this.#ky
      .get(`campaigns/${encodeURIComponent(slug)}/stats/${address}`)
      .json();
  }

  public static async getEarnings(slug: string): Promise<EarningsResponse> {
    return this.#ky
      .get(`campaigns/${encodeURIComponent(slug)}/earnings`)
      .json();
  }

  public static async getTeamLeaderboard(
    slug: string,
    address?: string
  ): Promise<TeamLeaderboardResponse> {
    return this.#ky
      .get(`campaigns/${encodeURIComponent(slug)}/leaderboard`, {
        searchParams: address ? { address } : {},
      })
      .json();
  }

  public static async getVolumeLeaderboard(
    slug: string,
    periodId: string
  ): Promise<VolumeLeaderboardResponse> {
    return this.#ky
      .get(`campaigns/${encodeURIComponent(slug)}/leaderboard`, {
        searchParams: { id: periodId },
      })
      .json();
  }

  public static async getTotalClaims(
    address: string
  ): Promise<TotalClaimsResponse> {
    return this.#ky.get(`campaigns/total-claims/${address}`).json();
  }

  public static async getClaimTransaction(req: {
    slug: string;
    address: string;
    claimUntilBox?: number;
  }): Promise<{ transaction: string }> {
    return this.#ky
      .get(`campaigns/${encodeURIComponent(req.slug)}/claim`, {
        searchParams: {
          address: req.address,
          ...(req.claimUntilBox !== undefined && {
            claimUntilBox: req.claimUntilBox,
          }),
        },
      })
      .json();
  }

  public static async postClaim(req: {
    slug: string;
    address: string;
    claimUntilBox?: number;
    signedTx: string;
  }): Promise<PostClaimResponse> {
    return this.#ky
      .post(`campaigns/${encodeURIComponent(req.slug)}/postClaim`, {
        json: {
          address: req.address,
          claimUntilBox: req.claimUntilBox,
          signedTx: req.signedTx,
        },
        timeout: false,
      })
      .json();
  }

  public static async postApplication(
    body: CampaignApplication
  ): Promise<{ ok: boolean }> {
    return this.#remoteKy
      .post("reward-campaign-applications", { json: body })
      .json();
  }
}
