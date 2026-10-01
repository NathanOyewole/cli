import { isAddress, type Address, type Base64EncodedBytes } from "@solana/kit";
import type { Command } from "commander";

import { DatapiClient, type Token } from "../clients/DatapiClient.ts";
import {
  InviteClient,
  type CraftInviteTxResponse,
  type InviteInfo,
} from "../clients/InviteClient.ts";
import { Asset, resolveWalletAsset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { InviteCode } from "../lib/InviteCode.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { Swap } from "../lib/Swap.ts";

const NATIVE_MINT = "11111111111111111111111111111111";

type TokenRef = { id: string; symbol: string; decimals: number };

export class GiftCommand {
  public static register(program: Command): void {
    const gift = program
      .command("gift")
      .description("Send tokens as a claimable gift link");
    gift
      .command("create")
      .description("Create a gift link funded from your wallet")
      .requiredOption("--token <token>", "Token to gift (symbol or mint)")
      .option("--amount <n>", "Amount in human-readable units")
      .option("--raw-amount <n>", "Amount in on-chain units")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.create(opts));
    gift
      .command("claim")
      .description("Claim a gift into your wallet")
      .requiredOption("--code <code>", "Gift code or https://jup.ag/gift link")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.claim(opts));
    gift
      .command("info")
      .description("Show what an unclaimed gift contains")
      .requiredOption("--code <code>", "Gift code or https://jup.ag/gift link")
      .action((opts) => this.info(opts));
    gift
      .command("clawback")
      .description("Cancel an unclaimed gift and return the funds")
      .option("--invite <address>", "Gift address from 'gift pending'")
      .option("--code <code>", "Gift code or link")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.clawback(opts));
    for (const [name, description] of [
      ["pending", "List unclaimed gifts you sent"],
      ["history", "List claimed, cancelled and expired gifts"],
    ] as const) {
      gift
        .command(name)
        .description(description)
        .option("--key <name>", "Key to use (overrides active key)")
        .option("--address <address>", "Wallet address to look up")
        .option("--limit <n>", "Max results", "10")
        .option("--offset <n>", "Pagination offset (multiple of --limit)", "0")
        .action((opts) => this.list(name, opts));
    }
  }

  private static async create(opts: {
    token: string;
    amount?: string;
    rawAmount?: string;
    key?: string;
  }): Promise<void> {
    Swap.validateAmountOpts(opts);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const token = await resolveWalletAsset(signer.address, opts.token);
    const multiplier = Swap.getScaledUiMultiplier(token);
    const rawAmount =
      opts.rawAmount ??
      NumberConverter.toChainAmount(opts.amount!, token.decimals, multiplier);

    const code = InviteCode.generate();
    const inviteSigner = (await code.signer()).address;
    const craft = await InviteClient.craftInvite({
      senderAddress: signer.address,
      inviteSignerAddress: inviteSigner,
      amount: rawAmount,
      mint: token.id,
    });
    if (craft.error || !craft.transaction) {
      throw new Error(craft.error ?? "Failed to create the gift transaction.");
    }

    const inviteSigned = await code.sign(craft.transaction);
    const signature = await this.execute(signer, inviteSigned, craft.requestId);
    const amount = NumberConverter.fromChainAmount(
      rawAmount,
      token.decimals,
      multiplier
    );
    const valueUsd = craft.tokenUsdRate
      ? Number(amount) * craft.tokenUsdRate
      : null;
    const result = {
      ...(Config.dryRun && { dryRun: true }),
      sender: signer.address,
      code: code.code,
      link: code.link,
      invite: await InviteCode.invitePda(inviteSigner),
      inviteSigner,
      token: this.tokenRef(token),
      amount,
      valueUsd,
      networkFeeLamports: craft.feeLamports,
      expiresAt: this.isoFromUnix(craft.expireAt),
      signature,
      // Already signed by the gift keypair; only the sender signature is missing.
      ...(Config.dryRun && { transaction: inviteSigned }),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Sender", value: signer.address },
        {
          label: "Amount",
          value: `${amount} ${token.symbol} (${Output.formatDollar(valueUsd ?? undefined)})`,
        },
        { label: "Gift Link", value: code.link },
        { label: "Expires", value: this.localTime(result.expiresAt) },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
    if (!Config.dryRun) {
      console.log(
        "\nAnyone with this link can claim the gift. Share it privately."
      );
    }
  }

  private static async claim(opts: {
    code: string;
    key?: string;
  }): Promise<void> {
    const code = InviteCode.parse(opts.code);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const inviteSigner = (await code.signer()).address;
    const info = await InviteClient.getInfo(inviteSigner);
    if (!info) {
      throw new Error(
        "Gift not found. It may be claimed, cancelled or expired."
      );
    }
    const craft = await InviteClient.craftClaim({
      receiverAddress: signer.address,
      inviteSignerAddress: inviteSigner,
    });
    const transaction = this.requireTx(craft);
    const inviteSigned = await code.sign(transaction);
    const signature = await this.execute(signer, inviteSigned, craft.requestId);
    const token = await this.resolveGiftToken(info.mint);
    const amount = this.amount(
      info.amount,
      token?.decimals ?? info.tokenDecimals
    );
    const valueUsd = info.tokenUsdRate
      ? Number(amount) * info.tokenUsdRate
      : null;

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        receiver: signer.address,
        invite: info.inviteInfoAddress,
        token,
        amount,
        valueUsd,
        signature,
        ...(Config.dryRun && { transaction: inviteSigned }),
      });
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Receiver", value: signer.address },
        {
          label: "Amount",
          value: `${amount} ${token?.symbol ?? info.mint} (${Output.formatDollar(valueUsd ?? undefined)})`,
        },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  private static async info(opts: { code: string }): Promise<void> {
    const code = InviteCode.parse(opts.code);
    const inviteSigner = (await code.signer()).address;
    const info = await InviteClient.getInfo(inviteSigner);
    if (!info) {
      throw new Error(
        "Gift not found. It may be claimed, cancelled or expired."
      );
    }
    const token = await this.resolveGiftToken(info.mint);
    const amount = this.amount(
      info.amount,
      token?.decimals ?? info.tokenDecimals
    );
    const valueUsd = info.tokenUsdRate
      ? Number(amount) * info.tokenUsdRate
      : null;
    const expiresAt = this.isoFromUnix(info.expireAt);

    if (Output.isJson()) {
      Output.json({
        invite: info.inviteInfoAddress,
        inviteSigner,
        token,
        amount,
        valueUsd,
        expiresAt,
      });
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Gift", value: info.inviteInfoAddress },
        {
          label: "Amount",
          value: `${amount} ${token?.symbol ?? info.mint} (${Output.formatDollar(valueUsd ?? undefined)})`,
        },
        { label: "Expires", value: this.localTime(expiresAt) },
      ],
    });
  }

  private static async clawback(opts: {
    invite?: string;
    code?: string;
    key?: string;
  }): Promise<void> {
    if (!!opts.invite === !!opts.code) {
      throw new Error("Provide exactly one of --invite or --code.");
    }
    if (opts.invite && !isAddress(opts.invite)) {
      throw new Error(`Invalid gift address: ${opts.invite}`);
    }
    const invite = opts.invite
      ? (opts.invite as Address)
      : await InviteCode.invitePda(
          (await InviteCode.parse(opts.code!).signer()).address
        );
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const craft = await InviteClient.craftClawback({
      senderAddress: signer.address,
      inviteInfoAddress: invite,
    });
    const transaction = this.requireTx(craft);
    const signature = await this.execute(signer, transaction, craft.requestId);
    const token = craft.mint ? await this.resolveGiftToken(craft.mint) : null;
    const amount =
      craft.amount && token ? this.amount(craft.amount, token.decimals) : null;

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        sender: signer.address,
        invite,
        token,
        amount,
        signature,
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
        { label: "Sender", value: signer.address },
        { label: "Gift", value: invite },
        ...(amount && token
          ? [{ label: "Returned", value: `${amount} ${token.symbol}` }]
          : []),
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  private static async list(
    kind: "pending" | "history",
    opts: { key?: string; address?: string; limit: string; offset: string }
  ): Promise<void> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    const limit = Number(opts.limit);
    const offset = Number(opts.offset);
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error("--limit must be an integer between 1 and 100.");
    }
    if (!Number.isInteger(offset) || offset < 0 || offset % limit !== 0) {
      throw new Error("--offset must be a non-negative multiple of --limit.");
    }
    const address =
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey));
    const req = { address, page: offset / limit + 1, pageSize: limit };
    const res =
      kind === "pending"
        ? await InviteClient.getPending(req)
        : await InviteClient.getHistory(req);

    const mints = [...new Set(res.invites.map((i) => this.giftMint(i.mint)))];
    const tokens = new Map(
      (await DatapiClient.getTokensByMints(mints)).map((t) => [t.id, t])
    );
    const gifts = res.invites.map((i) => this.formatGift(i, tokens));

    if (Output.isJson()) {
      Output.json({
        gifts,
        next: res.hasMoreData ? offset + limit : null,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        invite: "Gift",
        amount: "Amount",
        status: "Status",
        receiver: "Receiver",
        time: kind === "pending" ? "Expires" : "Closed",
      },
      rows: gifts.map((g) => ({
        invite: g.invite,
        amount: `${g.amount ?? g.rawAmount} ${g.token?.symbol ?? ""}`.trim(),
        status: g.status,
        receiver: g.receiver ?? "\u2014",
        time: this.localTime(
          kind === "pending" ? g.expiresAt : (g.closedAt ?? g.expiresAt)
        ),
      })),
    });
    if (res.hasMoreData) {
      console.log("\nNext offset:", offset + limit);
    }
  }

  private static formatGift(i: InviteInfo, tokens: Map<string, Token>) {
    const token = tokens.get(this.giftMint(i.mint));
    const expiresAt = this.isoFromUnix(i.expiry);
    const status =
      i.action === "claim"
        ? "claimed"
        : i.action === "clawback"
          ? "cancelled"
          : expiresAt && Date.parse(expiresAt) < Date.now()
            ? "expired"
            : "pending";
    return {
      invite: i.invite_pda,
      inviteSigner: i.invite_signer,
      sender: i.sender,
      receiver: i.receiver,
      token: token ? this.tokenRef(token) : null,
      amount: token ? this.amount(i.amount, token.decimals) : null,
      rawAmount: i.amount,
      status,
      createdAt: this.isoFromUnix(i.creation_time),
      expiresAt,
      closedAt: this.isoFromUnix(i.deletion_time),
      signature: i.creation_tx,
      closeSignature: i.deletion_tx,
    };
  }

  private static async execute(
    signer: Signer,
    transaction: string,
    requestId: string
  ): Promise<string | null> {
    if (Config.dryRun) {
      return null;
    }
    const signedTransaction = await signer.signTransaction(
      transaction as Base64EncodedBytes
    );
    const res = await InviteClient.execute({ signedTransaction, requestId });
    if (res.status === "failed" || res.status === "Failed") {
      throw new Error(res.error ?? "Gift transaction failed.");
    }
    return res.signature;
  }

  private static requireTx(craft: CraftInviteTxResponse): string {
    if (craft.error || !craft.transaction) {
      throw new Error(craft.error ?? "Failed to build the gift transaction.");
    }
    return craft.transaction;
  }

  private static giftMint(mint: string | null): string {
    return !mint || mint === NATIVE_MINT ? Asset.SOL.id : mint;
  }

  private static async resolveGiftToken(
    mint: string | null
  ): Promise<TokenRef | null> {
    const id = this.giftMint(mint);
    const tokens = await DatapiClient.getTokensByMints([id]);
    const token = tokens.find((t) => t.id === id);
    return token ? this.tokenRef(token) : null;
  }

  private static tokenRef(token: Token): TokenRef {
    return { id: token.id, symbol: token.symbol, decimals: token.decimals };
  }

  private static amount(raw: string, decimals: number): string {
    return NumberConverter.fromChainAmount(raw, decimals);
  }

  private static isoFromUnix(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }

  private static localTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString() : "\u2014";
  }
}
