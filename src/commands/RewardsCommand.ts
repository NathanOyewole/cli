import type { Base64EncodedBytes } from "@solana/kit";
import chalk from "chalk";
import type { Command } from "commander";

import {
  RewardsClient,
  type Campaign,
  type VolumeLeaderboardPeriod,
} from "../clients/RewardsClient.ts";
import { Config } from "../lib/Config.ts";
import { Output } from "../lib/Output.ts";
import { RewardsCampaign } from "../lib/RewardsCampaign.ts";
import { Signer } from "../lib/Signer.ts";

export class RewardsCommand {
  public static register(program: Command): void {
    const rewards = program.command("rewards").description("Reward campaigns");
    rewards
      .command("campaigns")
      .description("Browse reward campaigns")
      .option("--status <status>", "Status filter: all, live, ended", "all")
      .option("--campaign <slug>", "Look up a single campaign by slug or ID")
      .action((opts) => this.campaigns(opts));
    rewards
      .command("leaderboard")
      .description("View a campaign's rankings")
      .requiredOption("--campaign <slug>", "Campaign slug or ID")
      .option(
        "--period <id>",
        "Round ID for volume-leaderboard campaigns (defaults to the current round)"
      )
      .option("--limit <n>", "Max results", "10")
      .action((opts) => this.leaderboard(opts));
    rewards
      .command("progress")
      .description("View a wallet's progress and earnings in a campaign")
      .requiredOption("--campaign <slug>", "Campaign slug or ID")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.progress(opts));
    rewards
      .command("unclaimed")
      .description("View unclaimed rewards across all campaigns")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.unclaimed(opts));
    rewards
      .command("claim")
      .description("Claim campaign rewards")
      .requiredOption("--campaign <slug>", "Campaign slug or ID")
      .option(
        "--boxes <n>",
        "Mystery cards to reveal for lootbox campaigns (defaults to all unopened)"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.claim(opts));
    rewards
      .command("apply")
      .description("Apply to run a reward campaign for your token")
      .requiredOption("--project <name>", "Project name")
      .requiredOption("--token <mint>", "Token mint address")
      .requiredOption(
        "--contact-method <method>",
        "Contact method: twitter, telegram, email, discord"
      )
      .requiredOption("--contact <value>", "Handle or email to reach you")
      .option("--goals <text>", "Campaign goals")
      .action((opts) => this.apply(opts));
  }

  private static async resolveAddress(opts: {
    key?: string;
    address?: string;
  }): Promise<string> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    return (
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey))
    );
  }

  private static summarize(campaign: Campaign) {
    return {
      slug: campaign.slug,
      id: campaign.id,
      title: campaign.title,
      status: RewardsCampaign.status(campaign),
      rewardType: campaign.reward.type,
      template: campaign.uiTemplate,
      rewardName: campaign.reward.rewardName ?? null,
      rewardMint: campaign.reward.assetId ?? null,
      poolUsd: RewardsCampaign.totalPoolUsd(campaign),
      remainingPoolUsd: RewardsCampaign.remainingPoolUsd(campaign),
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      claimStartsAt: campaign.claimStartsAt ?? null,
      claimEndsAt: campaign.claimEndsAt ?? null,
      redirectUrl: campaign.reward.redirectUrl ?? null,
    };
  }

  private static async campaigns(opts: {
    status: string;
    campaign?: string;
  }): Promise<void> {
    const filter = RewardsCampaign.parseStatusFilter(opts.status);
    if (opts.campaign && filter !== "all") {
      throw new Error("--campaign cannot be combined with --status.");
    }

    if (opts.campaign) {
      const campaign = await RewardsClient.getCampaign(opts.campaign);
      const detail = {
        ...this.summarize(campaign),
        description: campaign.description ?? null,
        canClaim: RewardsCampaign.canClaim(campaign),
        hasLeaderboard: this.leaderboardKind(campaign) !== null,
        periods: this.volumePeriods(campaign),
        reward: campaign.reward,
        rewardsPool: campaign.rewardsPool ?? null,
      };
      if (Output.isJson()) {
        Output.json({ campaign: detail });
        return;
      }
      Output.table({
        type: "vertical",
        rows: [
          { label: "Campaign", value: detail.slug },
          { label: "Title", value: detail.title },
          { label: "Status", value: detail.status },
          { label: "Reward", value: `${detail.rewardName ?? "—"}` },
          { label: "Type", value: detail.rewardType },
          { label: "Pool", value: Output.formatDollar(detail.poolUsd ?? 0) },
          {
            label: "Remaining",
            value: Output.formatDollar(detail.remainingPoolUsd ?? 0),
          },
          { label: "Starts", value: this.formatDate(detail.startsAt) },
          { label: "Ends", value: this.formatDate(detail.endsAt) },
          {
            label: "Claim Window",
            value: `${this.formatDate(detail.claimStartsAt)} — ${this.formatDate(detail.claimEndsAt)}`,
          },
          {
            label: "Can Claim",
            value: Output.formatBoolean(detail.canClaim),
          },
          ...(detail.redirectUrl
            ? [{ label: "Link", value: detail.redirectUrl }]
            : []),
        ],
      });
      if (detail.description) {
        console.log(detail.description);
      }
      return;
    }

    const { campaigns } = await RewardsClient.getCampaigns();
    const rows = campaigns
      .map((c) => this.summarize(c))
      .filter((c) => RewardsCampaign.matchesFilter(c.status, filter));

    if (Output.isJson()) {
      Output.json({ campaigns: rows });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        slug: "Campaign",
        title: "Title",
        status: "Status",
        rewardType: "Type",
        pool: "Pool",
        remaining: "Remaining",
        endsAt: "Ends",
      },
      rows: rows.map((c) => ({
        ...c,
        pool: Output.formatDollar(c.poolUsd ?? 0, { decimals: 0 }),
        remaining: Output.formatDollar(c.remainingPoolUsd ?? 0, {
          decimals: 0,
        }),
        endsAt: this.formatDate(c.endsAt),
      })),
      maxWidths: { title: 40 },
    });
  }

  private static leaderboardKind(
    campaign: Campaign
  ): "volume" | "teams" | "earnings" | null {
    if (campaign.reward.type === "redirect") {
      return null;
    }
    if (campaign.uiTemplate === "volume-leaderboard") {
      return "volume";
    }
    if (campaign.uiTemplate === "trading-competition-volume-vs") {
      return "teams";
    }
    return "earnings";
  }

  private static volumePeriods(
    campaign: Campaign
  ): (VolumeLeaderboardPeriod & { label: string })[] | null {
    const event = campaign.datapoints?.event;
    if (campaign.uiTemplate !== "volume-leaderboard" || !event?.periods) {
      return null;
    }
    return [
      ...event.periods.map((p, i) => ({ ...p, label: `Round ${i + 1}` })),
      ...(event.total
        ? [
            {
              ...event.total,
              label: "Overall",
              startTime: campaign.startsAt,
              endTime: campaign.endsAt,
            },
          ]
        : []),
    ];
  }

  private static defaultPeriodId(
    periods: VolumeLeaderboardPeriod[],
    now = new Date()
  ): string | undefined {
    const active = periods.find(
      (p) =>
        p.startTime &&
        p.endTime &&
        now >= new Date(p.startTime) &&
        now < new Date(p.endTime)
    );
    return (active ?? periods[0])?.id;
  }

  private static async leaderboard(opts: {
    campaign: string;
    period?: string;
    limit: string;
  }): Promise<void> {
    const campaign = await RewardsClient.getCampaign(opts.campaign);
    const kind = this.leaderboardKind(campaign);
    const limit = Number(opts.limit);
    if (kind === null) {
      throw new Error(
        `Campaign "${campaign.slug}" links to ${campaign.reward.redirectUrl ?? "another page"} and has no leaderboard.`
      );
    }
    if (opts.period && kind !== "volume") {
      throw new Error("--period only applies to volume-leaderboard campaigns.");
    }

    if (kind === "volume") {
      const periods = this.volumePeriods(campaign) ?? [];
      const periodId = opts.period ?? this.defaultPeriodId(periods);
      if (!periodId) {
        throw new Error("Campaign has no leaderboard rounds.");
      }
      const res = await RewardsClient.getVolumeLeaderboard(
        campaign.slug,
        periodId
      );
      const entries = res.leaderboard.slice(0, limit);
      if (Output.isJson()) {
        Output.json({
          campaign: campaign.slug,
          kind,
          period: res.period,
          periods: periods.map(({ id, label, startTime, endTime }) => ({
            id,
            label,
            startTime: startTime ?? null,
            endTime: endTime ?? null,
          })),
          prizePool: res.reward,
          rewardMint: campaign.reward.assetId ?? null,
          entries,
        });
        return;
      }
      const label = periods.find((p) => p.id === res.period.id)?.label;
      console.log(
        chalk.bold(`${campaign.title} — ${label ?? `Round ${periodId}`}`)
      );
      Output.table({
        type: "horizontal",
        headers: {
          rank: "Rank",
          address: "Address",
          points: "Points",
          multiplier: "Multiplier",
          prize: "Prize",
        },
        rows: entries.map((e) => ({
          ...e,
          points: Math.round(e.points).toLocaleString("en-US"),
          multiplier: `${e.multiplier.toFixed(2)}x`,
          prize: e.prize.toLocaleString("en-US", { maximumFractionDigits: 2 }),
        })),
      });
      return;
    }

    if (kind === "teams") {
      const res = await RewardsClient.getTeamLeaderboard(campaign.slug);
      const teams = res.teams.map((t) => ({
        name: t.name,
        mint: t.assetId,
        entries: t.leaderboard.slice(0, limit),
      }));
      if (Output.isJson()) {
        Output.json({
          campaign: campaign.slug,
          kind,
          teams,
          bonus: res.bonus ?? null,
        });
        return;
      }
      for (const team of teams) {
        console.log(chalk.bold(team.name));
        Output.table({
          type: "horizontal",
          headers: { rank: "Rank", address: "Address", volume: "Volume" },
          rows: team.entries.map((e) => ({
            ...e,
            volume: Output.formatDollar(e.volumeUsd, { decimals: 0 }),
          })),
        });
      }
      return;
    }

    const res = await RewardsClient.getEarnings(campaign.slug);
    const entries = res.earnings.slice(0, limit);
    if (Output.isJson()) {
      Output.json({
        campaign: campaign.slug,
        kind,
        rewardType: res.rewardType,
        rewardMint: campaign.reward.assetId ?? null,
        ...(res.totalEntries !== undefined && {
          totalEntries: res.totalEntries,
        }),
        entries,
      });
      return;
    }
    const isLootbox = res.rewardType === "lootbox";
    Output.table({
      type: "horizontal",
      headers: isLootbox
        ? {
            rank: "Rank",
            address: "Address",
            openedBoxes: "Cards Revealed",
            earnings: "Earnings",
          }
        : {
            rank: "Rank",
            address: "Address",
            amount: `Amount (${campaign.reward.rewardName ?? "tokens"})`,
            ...(res.rewardType === "raffle" && { numEntries: "Entries" }),
          },
      rows: entries.map((e) => ({
        ...e,
        earnings: Output.formatDollar(e.earningsUsd, { decimals: 2 }),
        amount: e.amount?.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        }),
      })),
    });
  }

  private static async progress(opts: {
    campaign: string;
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await this.resolveAddress(opts);
    const [campaign, stats] = await Promise.all([
      RewardsClient.getCampaign(opts.campaign),
      RewardsClient.getStats(opts.campaign, address),
    ]);
    const {
      type: _authType,
      assetId,
      ...fields
    } = stats as typeof stats & { type?: string };
    const claimable =
      RewardsCampaign.canClaim(campaign) &&
      ((stats.unopenedBoxes ?? 0) > 0 || (stats.unclaimedAmount ?? 0) > 0);

    if (Output.isJson()) {
      Output.json({
        campaign: campaign.slug,
        address,
        status: RewardsCampaign.status(campaign),
        claimable,
        rewardMint: assetId ?? campaign.reward.assetId ?? null,
        ...fields,
      });
      return;
    }

    const rows: { label: string; value: string }[] = [
      { label: "Campaign", value: campaign.title },
      { label: "Address", value: address },
      { label: "Status", value: RewardsCampaign.status(campaign) },
      { label: "Claimable", value: Output.formatBoolean(claimable) },
    ];
    const num = (n: number | undefined) =>
      n === undefined
        ? "—"
        : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (stats.rank !== undefined) {
      rows.push({ label: "Rank", value: String(stats.rank) });
    }
    if (stats.rewardType === "lootbox") {
      rows.push(
        { label: "Cards Revealed", value: num(stats.openedBoxes) },
        { label: "Cards Unopened", value: num(stats.unopenedBoxes) },
        { label: "Progress to Next", value: `${num(stats.progressPct)}%` },
        { label: "Earnings", value: Output.formatDollar(stats.earningsUsd) }
      );
    } else {
      const unit = campaign.reward.rewardName ?? "tokens";
      rows.push(
        { label: "Unclaimed", value: `${num(stats.unclaimedAmount)} ${unit}` },
        { label: "Claimed", value: `${num(stats.claimedAmount)} ${unit}` }
      );
    }
    if (stats.numEntries !== undefined) {
      rows.push({ label: "Raffle Entries", value: num(stats.numEntries) });
    }
    Output.table({ type: "vertical", rows });
    for (const round of stats.stats ?? []) {
      console.log(
        `Round ${round.id}: rank ${round.rank ?? "—"}, ${num(round.points)} pts, prize ${num(round.prize)}`
      );
    }
  }

  private static async unclaimed(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await this.resolveAddress(opts);
    const res = await RewardsClient.getTotalClaims(address);
    const rewards = res.unclaimedRewards.map((r) =>
      r.type === "lootbox"
        ? {
            campaign: r.campaignSlug,
            title: r.campaignTitle,
            type: r.type,
            unopenedBoxes: r.unopenedBoxes,
            mint: null,
            symbol: null,
            amount: null,
            valueUsd: null,
          }
        : {
            campaign: r.campaignSlug,
            title: r.campaignTitle,
            type: r.type,
            unopenedBoxes: null,
            mint: r.tokenAddress,
            symbol: r.tokenSymbol,
            amount: Number(r.uiAmount),
            valueUsd: r.usdValue,
          }
    );
    const unclaimedUsd = rewards.reduce((sum, r) => sum + (r.valueUsd ?? 0), 0);

    if (Output.isJson()) {
      Output.json({
        address,
        earnedUsd: res.totalUsd,
        referralEarnedUsd: res.totalReferralUsd,
        unclaimedUsd,
        rewards,
      });
      return;
    }
    console.log(
      `Earned: ${Output.formatDollar(res.totalUsd, { decimals: 2 })}`
    );
    console.log(
      `Unclaimed: ${Output.formatDollar(unclaimedUsd, { decimals: 2 })}`
    );
    Output.table({
      type: "horizontal",
      headers: {
        campaign: "Campaign",
        reward: "Reward",
        value: "Value",
      },
      rows: rewards.map((r) => ({
        campaign: r.campaign,
        reward:
          r.type === "lootbox"
            ? `${r.unopenedBoxes} unopened cards`
            : `${r.amount?.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${r.symbol}`,
        value: Output.formatDollar(r.valueUsd ?? 0, { decimals: 2 }),
      })),
    });
  }

  private static async claim(opts: {
    campaign: string;
    boxes?: string;
    key?: string;
  }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const campaign = await RewardsClient.getCampaign(opts.campaign);
    if (!RewardsCampaign.canClaim(campaign)) {
      throw new Error(
        `Campaign "${campaign.slug}" is not claimable (status: ${RewardsCampaign.status(campaign)}).`
      );
    }
    const stats = await RewardsClient.getStats(campaign.slug, signer.address);

    let claimUntilBox: number | undefined;
    if (stats.rewardType === "lootbox") {
      const unopened = stats.unopenedBoxes ?? 0;
      const boxes = opts.boxes === undefined ? unopened : Number(opts.boxes);
      if (!Number.isInteger(boxes) || boxes < 1) {
        throw new Error("--boxes must be a positive integer.");
      }
      if (unopened === 0) {
        throw new Error("No unopened cards to reveal.");
      }
      if (boxes > unopened) {
        throw new Error(`Only ${unopened} unopened cards available.`);
      }
      claimUntilBox = (stats.openedBoxes ?? 0) + boxes;
    } else {
      if (opts.boxes !== undefined) {
        throw new Error("--boxes only applies to lootbox campaigns.");
      }
      if (!stats.unclaimedAmount) {
        throw new Error("Nothing to claim.");
      }
    }

    const { transaction } = await RewardsClient.getClaimTransaction({
      slug: campaign.slug,
      address: signer.address,
      claimUntilBox,
    });

    const res = Config.dryRun
      ? null
      : await RewardsClient.postClaim({
          slug: campaign.slug,
          address: signer.address,
          claimUntilBox,
          signedTx: await signer.signTransaction(
            transaction as Base64EncodedBytes
          ),
        });

    const claimed =
      res?.claimedRewards?.map((r) => ({
        mint: r.assetId,
        amount: r.uiAmount,
        valueUsd: r.usdValue,
      })) ??
      (res?.claimedAmount !== undefined
        ? [
            {
              mint: res.assetId ?? null,
              amount: res.claimedAmount,
              valueUsd: null,
            },
          ]
        : null);

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        campaign: campaign.slug,
        address: signer.address,
        rewardType: stats.rewardType,
        claimUntilBox: claimUntilBox ?? null,
        expectedAmount: stats.unclaimedAmount ?? null,
        valueUsd: res?.totalUsdValue ?? null,
        claimed,
        signature: res?.transactionId ?? null,
        ...(Config.dryRun && { transaction }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Campaign", value: campaign.title },
        { label: "Address", value: signer.address },
        ...(claimUntilBox !== undefined
          ? [
              {
                label: "Cards to Reveal",
                value: String(claimUntilBox - (stats.openedBoxes ?? 0)),
              },
            ]
          : [
              {
                label: "Amount",
                value: `${stats.unclaimedAmount} ${campaign.reward.rewardName ?? ""}`,
              },
            ]),
        ...(res
          ? [
              {
                label: "Value",
                value: Output.formatDollar(res.totalUsdValue, { decimals: 2 }),
              },
              { label: "Tx Signature", value: res.transactionId },
            ]
          : []),
      ],
    });
  }

  private static async apply(opts: {
    project: string;
    token: string;
    contactMethod: string;
    contact: string;
    goals?: string;
  }): Promise<void> {
    const application = RewardsCampaign.buildApplication(opts);
    if (!Config.dryRun) {
      await RewardsClient.postApplication(application);
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        submitted: !Config.dryRun,
        application,
      });
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Project", value: application.projectName },
        { label: "Token", value: application.tokenMintAddress },
        {
          label: "Contact",
          value: `${application.contactValue} (${application.contactMethod})`,
        },
        ...(application.campaignGoals
          ? [{ label: "Goals", value: application.campaignGoals }]
          : []),
        { label: "Submitted", value: Output.formatBoolean(!Config.dryRun) },
      ],
    });
  }

  private static formatDate(iso: string | null | undefined): string {
    return iso ? new Date(iso).toLocaleDateString() : "—";
  }
}
