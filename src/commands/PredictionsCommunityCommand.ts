import chalk from "chalk";
import type { Command } from "commander";

import { PredictionsClient } from "../clients/PredictionsClient.ts";
import {
  PredictionsCommunityClient,
  type Clan,
  type Comment,
  type SessionAuth,
} from "../clients/PredictionsCommunityClient.ts";
import { Config } from "../lib/Config.ts";
import { Output } from "../lib/Output.ts";
import {
  PredictionsAuth,
  type CommentSession,
} from "../lib/PredictionsAuth.ts";
import { PredictionsFormat } from "../lib/PredictionsFormat.ts";
import { Signer } from "../lib/Signer.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEFRAME_TAGS = ["5m", "15m"];
const COMMENT_SORTS = ["newest", "oldest", "top"];

type Thread = { subcategory: string; tags: string[]; clanId?: string };
type ThreadOpts = {
  event?: string;
  arcade?: boolean;
  clan?: string;
  subcategory?: string;
  tags?: string;
};
type ClanWrite = {
  action: string;
  path: string;
  signedAction: string;
  details: Record<string, string>;
  body?: Record<string, unknown>;
};

function addThreadOptions(cmd: Command): Command {
  return cmd
    .option("--event <eventId>", "Comments on an event")
    .option("--arcade", "Arcade chat")
    .option("--clan <clan>", "Clan chat (ID or handle; members only)")
    .option("--subcategory <subcategory>", "Raw thread subcategory")
    .option("--tags <list>", "Raw thread tags, comma-separated");
}

export class PredictionsCommunityCommand {
  public static register(predictions: Command): void {
    this.registerClans(predictions);
    this.registerComments(predictions);
  }

  private static registerClans(predictions: Command): void {
    const clans = predictions
      .command("clans")
      .description("Prediction clans: browse, rank, create, and manage");
    clans
      .command("list")
      .description("List clans")
      .option("--search <query>", "Search by name")
      .option("--key <name>", "Only the clan this key's wallet belongs to")
      .option("--address <address>", "Only the clan this wallet belongs to")
      .option("--limit <n>", "Max results", "20")
      .option("--offset <n>", "Pagination offset", "0")
      .action((opts) => this.listClans(opts));
    clans
      .command("get")
      .description("Clan detail with members, invites, and join requests")
      .requiredOption("--clan <clan>", "Clan ID or handle")
      .action((opts) => this.getClan(opts));
    clans
      .command("rankings")
      .description("Weekly clan competition leaderboard")
      .option(
        "--week <date>",
        "Week start date, e.g. 2026-09-28 (default: current)"
      )
      .option("--limit <n>", "Max results", "20")
      .action((opts) => this.rankings(opts));
    clans
      .command("invites")
      .description("Clan invitations received by your wallet (signed request)")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.receivedInvites(opts));

    const clanWrite = (
      name: string,
      description: string,
      configure: (cmd: Command) => Command,
      build: (opts: Record<string, string>, clan: Clan | null) => ClanWrite
    ) =>
      configure(clans.command(name).description(description))
        .option("--key <name>", "Key to use for signing")
        .action((opts) => this.clanWrite(opts, build));

    clanWrite(
      "create",
      "Create a clan",
      (c) =>
        c
          .requiredOption("--name <name>", "Clan name")
          .requiredOption("--handle <handle>", "Clan handle (URL slug)")
          .option("--description <text>", "Clan description"),
      (o) => ({
        action: "create",
        path: "clans",
        signedAction: "Create clan",
        details: {
          Name: o.name!,
          Handle: o.handle!,
          ...(o.description && { Description: o.description }),
        },
        body: {
          name: o.name,
          slug: o.handle,
          ...(o.description && { description: o.description }),
        },
      })
    );
    clanWrite(
      "join",
      "Request to join a clan",
      (c) => c.requiredOption("--clan <clan>", "Clan ID or handle"),
      (_o, clan) => ({
        action: "join",
        path: `clans/${clan!.id}/join-requests`,
        signedAction: "Request to join clan",
        details: { Clan: clan!.name, ClanId: clan!.id },
      })
    );
    clanWrite(
      "leave",
      "Leave a clan",
      (c) => c.requiredOption("--clan <clan>", "Clan ID or handle"),
      (_o, clan) => ({
        action: "leave",
        path: `clans/${clan!.id}/leave`,
        signedAction: "Leave clan",
        details: { ClanId: clan!.id },
      })
    );
    clanWrite(
      "invite",
      "Invite a wallet to your clan",
      (c) =>
        c
          .requiredOption("--clan <clan>", "Clan ID or handle")
          .requiredOption("--member <address>", "Wallet to invite"),
      (o, clan) => ({
        action: "invite",
        path: `clans/${clan!.id}/invites`,
        signedAction: "Invite clan member",
        details: { ClanId: clan!.id, Invitee: o.member! },
        body: { invitedOwnerPubkey: o.member },
      })
    );
    for (const [name, description, signedAction] of [
      ["accept", "Accept a clan invitation", "Accept clan invitation"],
      ["revoke", "Revoke an invitation you sent", "Revoke clan invitation"],
    ] as const) {
      clanWrite(
        name,
        description,
        (c) =>
          c
            .requiredOption("--clan <clan>", "Clan ID or handle")
            .requiredOption("--invite <id>", "Invitation ID"),
        (o, clan) => ({
          action: name,
          path: `clans/${clan!.id}/invites/${o.invite}/${name}`,
          signedAction,
          details: { ClanId: clan!.id, InviteId: o.invite! },
        })
      );
    }
    for (const [name, description, signedAction] of [
      ["approve", "Approve a join request", "Approve clan join request"],
      ["reject", "Reject a join request", "Reject clan join request"],
    ] as const) {
      clanWrite(
        name,
        description,
        (c) =>
          c
            .requiredOption("--clan <clan>", "Clan ID or handle")
            .requiredOption("--request <id>", "Join request ID"),
        (o, clan) => ({
          action: name,
          path: `clans/${clan!.id}/join-requests/${o.request}/${name}`,
          signedAction,
          details: { ClanId: clan!.id, RequestId: o.request! },
        })
      );
    }
    clanWrite(
      "kick",
      "Remove a member from your clan",
      (c) =>
        c
          .requiredOption("--clan <clan>", "Clan ID or handle")
          .requiredOption("--member <address>", "Member wallet"),
      (o, clan) => ({
        action: "kick",
        path: `clans/${clan!.id}/members/${o.member}/kick`,
        signedAction: "Remove clan member",
        details: { ClanId: clan!.id, Member: o.member! },
      })
    );
  }

  private static registerComments(predictions: Command): void {
    const comments = predictions
      .command("comments")
      .description("Event, arcade, and clan comments");
    addThreadOptions(comments.command("list").description("Read a thread"))
      .option("--sort <sort>", `Sort: ${COMMENT_SORTS.join(", ")}`, "newest")
      .option("--limit <n>", "Max results", "20")
      .option("--cursor <cursor>", "Pagination cursor from a previous page")
      .option("--key <name>", "Key to use (needed for clan chat)")
      .option("--address <address>", "Mark comments this wallet liked")
      .action((opts) => this.listComments(opts));
    addThreadOptions(comments.command("post").description("Post a comment"))
      .requiredOption("--text <text>", "Comment text")
      .option("--reply <commentId>", "Reply to a comment")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.postComment(opts));
    comments
      .command("like")
      .description("Like or unlike a comment")
      .requiredOption("--comment <commentId>", "Comment ID")
      .option("--unlike", "Remove your like")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.likeComment(opts));
    comments
      .command("delete")
      .description("Delete your comment")
      .requiredOption("--comment <commentId>", "Comment ID")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.deleteComment(opts));
  }

  private static async resolveClan(idOrHandle: string): Promise<Clan> {
    return UUID_RE.test(idOrHandle)
      ? PredictionsCommunityClient.getClan(idOrHandle)
      : PredictionsCommunityClient.getClanBySlug(idOrHandle.replace(/^@/, ""));
  }

  private static clanJson(c: Clan) {
    return {
      clanId: c.id,
      name: c.name,
      handle: c.slug,
      description: c.description,
      leader: c.leaderOwnerPubkey,
      memberCount: c.memberCount ?? null,
      createdAt: c.createdAt,
    };
  }

  private static async listClans(opts: {
    search?: string;
    key?: string;
    address?: string;
    limit: string;
    offset: string;
  }): Promise<void> {
    const { start, end } = PredictionsFormat.parsePagination(opts);
    const member =
      opts.key || opts.address
        ? await PredictionsFormat.resolveAddress(opts)
        : undefined;
    const [res, stats] = await Promise.all([
      PredictionsCommunityClient.listClans({
        limit: end - start,
        offset: start,
        search: opts.search,
        walletAddress: member,
      }),
      PredictionsCommunityClient.getClanStats(),
    ]);
    const clans = res.data.map((c) => this.clanJson(c));

    if (Output.isJson()) {
      Output.json({
        totalClans: stats.totalClans,
        totalMembers: stats.totalClanMembers,
        clans,
        ...(res.pagination.hasNext && { next: end }),
      });
      return;
    }
    console.log(`${stats.totalClans} clans, ${stats.totalClanMembers} members`);
    Output.table({
      type: "horizontal",
      headers: {
        name: "Clan",
        handle: "Handle",
        members: "Members",
        clanId: "Clan ID",
      },
      rows: clans.map((c) => ({
        name: c.name,
        handle: `@${c.handle}`,
        members: c.memberCount ?? "—",
        clanId: c.clanId,
      })),
    });
    if (res.pagination.hasNext) {
      console.log("\nNext offset:", end);
    }
  }

  private static async getClan(opts: { clan: string }): Promise<void> {
    const clan = await this.resolveClan(opts.clan);
    const [members, invites, requests] = await Promise.all([
      PredictionsCommunityClient.getMembers(clan.id),
      PredictionsCommunityClient.getInvites(clan.id),
      PredictionsCommunityClient.getJoinRequests(clan.id),
    ]);
    const json = {
      ...this.clanJson(clan),
      memberCount: members.data.length,
      members: members.data.map((m) => ({
        address: m.ownerPubkey,
        role: m.role,
        joinedAt: m.joinedAt,
      })),
      invites: invites.data
        .filter((i) => i.status === "pending")
        .map((i) => ({
          inviteId: i.id,
          address: i.invitedOwnerPubkey,
          invitedBy: i.invitedByOwnerPubkey,
          expiresAt: i.expiresAt,
        })),
      joinRequests: requests.data
        .filter((r) => r.status === "pending")
        .map((r) => ({
          requestId: r.id,
          address: r.ownerPubkey,
          createdAt: r.createdAt,
        })),
    };

    if (Output.isJson()) {
      Output.json(json);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Clan", value: `${json.name} (@${json.handle})` },
        { label: "Clan ID", value: json.clanId },
        { label: "Description", value: json.description ?? "—" },
        { label: "Leader", value: json.leader },
        { label: "Members", value: String(json.memberCount) },
        { label: "Pending Invites", value: String(json.invites.length) },
        {
          label: "Pending Join Requests",
          value: String(json.joinRequests.length),
        },
      ],
    });
    Output.table({
      type: "horizontal",
      headers: { address: "Member", role: "Role", joined: "Joined" },
      rows: json.members.map((m) => ({
        address: m.address,
        role: m.role,
        joined: PredictionsFormat.formatDate(m.joinedAt),
      })),
    });
    if (json.joinRequests.length > 0) {
      Output.table({
        type: "horizontal",
        headers: { requestId: "Join Request", address: "Wallet" },
        rows: json.joinRequests,
      });
    }
  }

  private static async rankings(opts: {
    week?: string;
    limit: string;
  }): Promise<void> {
    const res = opts.week
      ? await PredictionsCommunityClient.getCompetitionLeaderboardByWeek(
          opts.week
        )
      : await PredictionsCommunityClient.getCompetitionLeaderboard(
          (await PredictionsCommunityClient.getCurrentCompetition()).id
        );
    const rankings = res.data.slice(0, Number(opts.limit)).map((r) => ({
      rank: r.rank,
      clanId: r.clanId,
      name: r.clanName,
      handle: r.clanSlug,
      pnlUsd: Number(r.totalPnlUsd),
      volumeUsd: Number(r.totalVolumeUsd),
      qualified: r.qualified,
      memberCount: r.memberCount,
    }));
    const competition = {
      competitionId: res.competition.id,
      startsAt: res.competition.periodStart,
      endsAt: res.competition.periodEnd,
      minVolumeUsd: Number(res.competition.volumeCutoffUsd),
      status: res.competition.status,
    };

    if (Output.isJson()) {
      Output.json({ ...competition, rankings });
      return;
    }
    console.log(
      `Week ${PredictionsFormat.formatDate(competition.startsAt)} – ${PredictionsFormat.formatDate(competition.endsAt)} (${competition.status}); clans need ${Output.formatDollar(competition.minVolumeUsd, { decimals: 0 })} volume to qualify`
    );
    Output.table({
      type: "horizontal",
      headers: {
        rank: "#",
        name: "Clan",
        pnl: "PnL",
        volume: "Volume",
        members: "Members",
        qualified: "Qualified",
      },
      rows: rankings.map((r) => ({
        rank: r.rank,
        name: `${r.name} (@${r.handle})`,
        pnl: Output.formatDollarChange(r.pnlUsd),
        volume: Output.formatDollar(r.volumeUsd, { decimals: 0 }),
        members: r.memberCount,
        qualified: Output.formatBoolean(r.qualified),
      })),
    });
  }

  private static async receivedInvites(opts: { key?: string }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const signature = await PredictionsAuth.signClanAction(
      signer,
      "View received clan invitations",
      {}
    );
    const res = await PredictionsCommunityClient.postClanAction<{
      data: {
        invite: {
          id: string;
          expiresAt: string | null;
          invitedByOwnerPubkey: string;
        };
        clan: Clan;
      }[];
    }>("clans/invites/received", signature);
    const invites = res.data.map(({ invite, clan }) => ({
      inviteId: invite.id,
      clanId: clan.id,
      clan: clan.name,
      handle: clan.slug,
      invitedBy: invite.invitedByOwnerPubkey,
      expiresAt: invite.expiresAt,
    }));

    if (Output.isJson()) {
      Output.json({ address: signer.address, count: invites.length, invites });
      return;
    }
    if (invites.length === 0) {
      console.log("No clan invitations.");
      return;
    }
    Output.table({
      type: "horizontal",
      headers: { clan: "Clan", inviteId: "Invite ID", clanId: "Clan ID" },
      rows: invites,
    });
  }

  private static async clanWrite(
    opts: Record<string, string>,
    build: (opts: Record<string, string>, clan: Clan | null) => ClanWrite
  ): Promise<void> {
    const clan = opts.clan ? await this.resolveClan(opts.clan) : null;
    const write = build(opts, clan);
    const keyName = opts.key ?? Config.load().activeKey;
    const wallet = await Signer.loadAddress(keyName);

    if (Config.dryRun) {
      const message = PredictionsAuth.clanMessage(
        write.signedAction,
        write.details,
        wallet,
        Date.now()
      );
      if (Output.isJson()) {
        Output.json({
          dryRun: true,
          action: write.action,
          clanId: clan?.id ?? null,
          address: wallet,
          message,
          request: { path: write.path, body: write.body ?? {} },
        });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      console.log(`Would sign and submit:\n${message}`);
      return;
    }

    const signer = await Signer.load(keyName);
    const signature = await PredictionsAuth.signClanAction(
      signer,
      write.signedAction,
      write.details
    );
    const result = await PredictionsCommunityClient.postClanAction<
      Record<string, unknown>
    >(write.path, { ...signature, ...write.body });

    if (Output.isJson()) {
      Output.json({ action: write.action, clanId: clan?.id ?? null, result });
      return;
    }
    console.log(`${chalk.green("Done:")} ${write.signedAction}.`);
  }

  private static async resolveThread(opts: ThreadOpts): Promise<Thread> {
    const chosen = [
      opts.event,
      opts.arcade,
      opts.clan,
      opts.subcategory,
    ].filter(Boolean).length;
    if (chosen !== 1) {
      throw new Error(
        "Provide exactly one of --event, --arcade, --clan, or --subcategory."
      );
    }
    if (opts.arcade) {
      return { subcategory: "arcade", tags: ["1m"] };
    }
    if (opts.clan) {
      const clan = await this.resolveClan(opts.clan);
      return { subcategory: "clan", tags: [clan.id], clanId: clan.id };
    }
    if (opts.subcategory) {
      return {
        subcategory: opts.subcategory,
        tags: (opts.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };
    }
    const event = await PredictionsClient.getEvent(opts.event!);
    return this.eventThread(event);
  }

  /** Event threads are keyed by subcategory; timed events add their series and timeframe tags. */
  public static eventThread(event: {
    category: string;
    subcategory: string;
    tags?: string[];
    markets: { provider?: string }[];
  }): Thread {
    if (!event.subcategory) {
      throw new Error("This event has no comment thread.");
    }
    const timeframe = event.tags?.find((t) => TIMEFRAME_TAGS.includes(t));
    const isBisonfi =
      event.markets.length > 0 &&
      event.markets.every((m) => m.provider === "bisonfi");
    if (
      timeframe &&
      event.subcategory === "stocks" &&
      isBisonfi &&
      event.tags?.includes("spcx")
    ) {
      return { subcategory: event.subcategory, tags: ["spcx", timeframe] };
    }
    if (timeframe && event.category === "crypto") {
      return { subcategory: event.subcategory, tags: [timeframe] };
    }
    return { subcategory: event.subcategory, tags: [] };
  }

  private static async openSession(signer: Signer): Promise<CommentSession> {
    const { session, expiresAt, message } =
      await PredictionsAuth.newCommentSession(signer.address);
    const signed = await PredictionsAuth.signWithWallet(signer, message);
    const created = await PredictionsCommunityClient.createSession({
      walletAddress: signer.address,
      sessionPublicKey: session.sessionPublicKey,
      nonce: session.nonce,
      expiresAt,
      ...signed,
    });
    return { ...session, nonce: created.nonce };
  }

  private static commentJson(c: Comment): Record<string, unknown> {
    return {
      commentId: c.id,
      address: c.walletAddress,
      text: c.text,
      likes: c.likeCount,
      likedByMe: c.likedByMe,
      createdAt: c.createdAt,
      replies: c.replies.map((r) => this.commentJson(r)),
    };
  }

  private static async listComments(
    opts: ThreadOpts & {
      sort: string;
      limit: string;
      cursor?: string;
      key?: string;
      address?: string;
    }
  ): Promise<void> {
    if (!COMMENT_SORTS.includes(opts.sort)) {
      throw new Error(
        `Invalid --sort. Must be one of: ${COMMENT_SORTS.join(", ")}.`
      );
    }
    const thread = await this.resolveThread(opts);
    const limit = Number(opts.limit);
    let headers: Record<string, string> | undefined;
    let walletAddress = opts.address;
    if (thread.clanId) {
      const signer = await Signer.load(opts.key ?? Config.load().activeKey);
      walletAddress ??= signer.address;
      const session = await this.openSession(signer);
      const timestamp = Date.now();
      const payload = PredictionsAuth.clanChatReadPayload({
        sessionPublicKey: session.sessionPublicKey,
        clanId: thread.clanId,
        sort: opts.sort,
        cursor: opts.cursor ?? null,
        limit,
        timestamp,
        nonce: session.nonce,
      });
      headers = {
        "x-comment-session-public-key": session.sessionPublicKey,
        "x-comment-nonce": session.nonce,
        "x-comment-signature": await PredictionsAuth.signWithSession(
          session,
          payload
        ),
        "x-comment-timestamp": String(timestamp),
      };
    } else if (opts.key && !walletAddress) {
      walletAddress = await PredictionsFormat.resolveAddress(opts);
    }
    const res = await PredictionsCommunityClient.getComments(
      {
        subcategory: thread.subcategory,
        tags: thread.tags,
        walletAddress,
        sort: opts.sort,
        cursor: opts.cursor,
        limit,
      },
      headers
    );
    const comments = res.data.map((c) => this.commentJson(c));

    if (Output.isJson()) {
      Output.json({
        subcategory: thread.subcategory,
        tags: thread.tags,
        comments,
        next: res.pageInfo.hasNext ? res.pageInfo.nextCursor : null,
      });
      return;
    }
    if (comments.length === 0) {
      console.log("No comments yet.");
      return;
    }
    const rows: Record<string, unknown>[] = [];
    for (const c of res.data) {
      for (const [comment, depth] of [
        [c, 0] as const,
        ...c.replies.map((r) => [r, 1] as const),
      ]) {
        rows.push({
          author:
            (depth ? "  └ " : "") +
            `${comment.walletAddress.slice(0, 4)}…${comment.walletAddress.slice(-4)}`,
          text: comment.text,
          likes: comment.likeCount,
          time: PredictionsFormat.formatDateTime(comment.createdAt),
          commentId: chalk.gray(comment.id),
        });
      }
    }
    Output.table({
      type: "horizontal",
      headers: {
        author: "Author",
        text: "Comment",
        likes: "Likes",
        time: "Time",
        commentId: "Comment ID",
      },
      maxWidths: { text: 50 },
      rows,
    });
    if (res.pageInfo.hasNext) {
      console.log(`\nNext cursor: ${res.pageInfo.nextCursor}`);
    }
  }

  /**
   * Shared by every comment write: in dry-run, show what the wallet would sign;
   * otherwise authorize a session key and sign the payload with it.
   */
  private static async commentWrite<T>(
    keyName: string | undefined,
    preview: Record<string, unknown>,
    payload: (session: CommentSession, timestamp: number) => string,
    submit: (auth: SessionAuth) => Promise<T>
  ): Promise<T | null> {
    const key = keyName ?? Config.load().activeKey;
    if (Config.dryRun) {
      const wallet = await Signer.loadAddress(key);
      const { message } = await PredictionsAuth.newCommentSession(wallet);
      if (Output.isJson()) {
        Output.json({ dryRun: true, ...preview, address: wallet, message });
      } else {
        console.log(Output.DRY_RUN_LABEL);
        console.log(
          `Would authorize a comment session by signing:\n${message}`
        );
      }
      return null;
    }
    const signer = await Signer.load(key);
    const session = await this.openSession(signer);
    const timestamp = Date.now();
    const signature = await PredictionsAuth.signWithSession(
      session,
      payload(session, timestamp)
    );
    return submit({
      sessionPublicKey: session.sessionPublicKey,
      nonce: session.nonce,
      timestamp,
      signature,
    });
  }

  private static async postComment(
    opts: ThreadOpts & { text: string; reply?: string; key?: string }
  ): Promise<void> {
    const thread = await this.resolveThread(opts);
    const comment = await this.commentWrite(
      opts.key,
      {
        action: "comment",
        subcategory: thread.subcategory,
        tags: thread.tags,
        text: opts.text,
        replyTo: opts.reply ?? null,
      },
      (session, timestamp) =>
        PredictionsAuth.commentPayload({
          sessionPublicKey: session.sessionPublicKey,
          subcategory: thread.subcategory,
          tags: thread.tags,
          parentCommentId: opts.reply ?? null,
          timestamp,
          nonce: session.nonce,
          text: opts.text,
        }),
      (auth) =>
        PredictionsCommunityClient.postComment({
          text: opts.text,
          subcategory: thread.subcategory,
          ...(thread.tags.length > 0 && { tags: thread.tags }),
          ...(opts.reply && { parentCommentId: opts.reply }),
          ...auth,
        })
    );
    if (!comment) {
      return;
    }
    if (Output.isJson()) {
      Output.json({ action: "comment", ...this.commentJson(comment) });
      return;
    }
    console.log(`${chalk.green("Posted")} comment ${comment.id}.`);
  }

  private static async likeComment(opts: {
    comment: string;
    unlike?: boolean;
    key?: string;
  }): Promise<void> {
    const liked = !opts.unlike;
    const comment = await this.commentWrite(
      opts.key,
      { action: liked ? "like" : "unlike", commentId: opts.comment },
      (session, timestamp) =>
        PredictionsAuth.commentLikePayload({
          sessionPublicKey: session.sessionPublicKey,
          commentId: opts.comment,
          timestamp,
          nonce: session.nonce,
          liked,
        }),
      (auth) =>
        PredictionsCommunityClient.likeComment(opts.comment, liked, auth)
    );
    if (!comment) {
      return;
    }
    if (Output.isJson()) {
      Output.json({
        action: liked ? "like" : "unlike",
        ...this.commentJson(comment),
      });
      return;
    }
    console.log(
      `${liked ? "Liked" : "Unliked"} comment ${comment.id} (${comment.likeCount} likes).`
    );
  }

  private static async deleteComment(opts: {
    comment: string;
    key?: string;
  }): Promise<void> {
    const res = await this.commentWrite(
      opts.key,
      { action: "delete", commentId: opts.comment },
      (session, timestamp) =>
        PredictionsAuth.commentDeletePayload({
          sessionPublicKey: session.sessionPublicKey,
          commentId: opts.comment,
          timestamp,
          nonce: session.nonce,
        }),
      (auth) => PredictionsCommunityClient.deleteComment(opts.comment, auth)
    );
    if (!res) {
      return;
    }
    if (Output.isJson()) {
      Output.json({
        action: "delete",
        commentId: res.id,
        deleted: res.deleted,
      });
      return;
    }
    console.log(`Deleted comment ${res.id}.`);
  }
}
