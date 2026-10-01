import { ClientConfig } from "./ClientConfig.ts";

import type { WalletSignature } from "../lib/PredictionsAuth.ts";

export type Clan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  leaderOwnerPubkey: string;
  createdByOwnerPubkey: string;
  status: string;
  createdAt: string;
  memberCount?: number;
};

export type ClanMember = {
  ownerPubkey: string;
  role: string;
  status: string;
  joinedAt: string;
};

export type ClanInvite = {
  id: string;
  clanId: string;
  invitedOwnerPubkey: string;
  invitedByOwnerPubkey: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
};

export type ClanJoinRequest = {
  id: string;
  clanId: string;
  ownerPubkey: string;
  status: string;
  createdAt: string;
};

export type ClanCompetition = {
  id: string;
  periodStart: string;
  periodEnd: string;
  volumeCutoffUsd: string;
  status: string;
};

export type ClanRanking = {
  clanId: string;
  clanName: string;
  clanSlug: string;
  rank: number;
  totalPnlUsd: string;
  totalVolumeUsd: string;
  qualified: boolean;
  memberCount: number;
};

export type Comment = {
  id: string;
  walletAddress: string;
  text: string;
  likeCount: number;
  likedByMe: boolean;
  replies: Comment[];
  createdAt: string;
};

export type CommentsResponse = {
  data: Comment[];
  pageInfo: { nextCursor: string | null; hasNext: boolean };
};

export type SessionAuth = {
  sessionPublicKey: string;
  nonce: string;
  timestamp: number;
  signature: string;
};

export class PredictionsCommunityClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/prediction/v1`,
  });

  public static async listClans(params: {
    limit: number;
    offset: number;
    search?: string;
    walletAddress?: string;
  }): Promise<{ data: Clan[]; pagination: { hasNext: boolean } }> {
    const searchParams = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined)
    ) as Record<string, string | number>;
    return this.#ky.get("clans", { searchParams }).json();
  }

  public static async getClanStats(): Promise<{
    totalClans: number;
    totalClanMembers: number;
  }> {
    return this.#ky.get("clans/stats").json();
  }

  public static async getClan(clanId: string): Promise<Clan> {
    return this.#ky.get(`clans/${clanId}`).json();
  }

  public static async getClanBySlug(slug: string): Promise<Clan> {
    return this.#ky.get(`clans/slug/${encodeURIComponent(slug)}`).json();
  }

  public static async getMembers(
    clanId: string
  ): Promise<{ data: ClanMember[] }> {
    return this.#ky.get(`clans/${clanId}/members`).json();
  }

  public static async getInvites(
    clanId: string
  ): Promise<{ data: ClanInvite[] }> {
    return this.#ky.get(`clans/${clanId}/invites`).json();
  }

  public static async getJoinRequests(
    clanId: string
  ): Promise<{ data: ClanJoinRequest[] }> {
    return this.#ky.get(`clans/${clanId}/join-requests`).json();
  }

  public static async getCurrentCompetition(): Promise<ClanCompetition> {
    return this.#ky.get("clan-competitions/current").json();
  }

  public static async getCompetitionLeaderboard(
    competitionId: string
  ): Promise<{ competition: ClanCompetition; data: ClanRanking[] }> {
    return this.#ky
      .get(`clan-competitions/${competitionId}/leaderboard`)
      .json();
  }

  public static async getCompetitionLeaderboardByWeek(
    week: string
  ): Promise<{ competition: ClanCompetition; data: ClanRanking[] }> {
    return this.#ky
      .get("clan-competitions/leaderboard", { searchParams: { week } })
      .json();
  }

  /** Every signed clan write is a POST of the action's fields plus the wallet signature. */
  public static async postClanAction<T>(
    path: string,
    body: WalletSignature & Record<string, unknown>
  ): Promise<T> {
    return this.#ky.post(path, { json: body }).json();
  }

  public static async setUsername(
    body: WalletSignature & { username: string }
  ): Promise<{ ownerPubkey: string; username: string }> {
    return this.#ky.post("profile/username", { json: body }).json();
  }

  public static async getComments(
    params: {
      subcategory: string;
      tags?: string[];
      walletAddress?: string;
      sort: string;
      cursor?: string;
      limit: number;
    },
    headers?: Record<string, string>
  ): Promise<CommentsResponse> {
    const searchParams: Record<string, string | number> = {
      subcategory: params.subcategory,
      sort: params.sort,
      limit: params.limit,
    };
    if (params.tags?.length) {
      searchParams.tags = params.tags.join(",");
    }
    if (params.walletAddress) {
      searchParams.walletAddress = params.walletAddress;
    }
    if (params.cursor) {
      searchParams.cursor = params.cursor;
    }
    return this.#ky.get("events/comments", { searchParams, headers }).json();
  }

  public static async createSession(body: {
    walletAddress: string;
    sessionPublicKey: string;
    nonce: string;
    expiresAt: number;
    message: string;
    signature: string;
  }): Promise<{ sessionPublicKey: string; nonce: string; expiresAt: number }> {
    return this.#ky.post("comments/sessions", { json: body }).json();
  }

  public static async postComment(
    body: SessionAuth & {
      text: string;
      subcategory: string;
      tags?: string[];
      parentCommentId?: string;
    }
  ): Promise<Comment> {
    return this.#ky.post("events/comments", { json: body }).json();
  }

  public static async likeComment(
    commentId: string,
    liked: boolean,
    body: SessionAuth
  ): Promise<Comment> {
    const path = `comments/${commentId}/likes`;
    return (
      liked
        ? this.#ky.post(path, { json: body })
        : this.#ky.delete(path, { json: body })
    ).json();
  }

  public static async deleteComment(
    commentId: string,
    body: SessionAuth
  ): Promise<{ id: string; deleted: boolean }> {
    return this.#ky.delete(`comments/${commentId}`, { json: body }).json();
  }
}
