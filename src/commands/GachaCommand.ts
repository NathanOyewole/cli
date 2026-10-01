import {
  getBase58Decoder,
  isAddress,
  type Base64EncodedBytes,
  type Base64EncodedWireTransaction,
} from "@solana/kit";
import chalk from "chalk";
import type { Command } from "commander";

import {
  GachaClient,
  type Machine,
  type OpenPackResult,
} from "../clients/GachaClient.ts";
import { Config } from "../lib/Config.ts";
import { Gacha, type OpenFailure } from "../lib/Gacha.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { GachaMarketCommand } from "./GachaMarketCommand.ts";
import { GachaShippingCommand } from "./GachaShippingCommand.ts";

const MAX_PACKS_PER_RUN = 10;

type Pull = {
  memo: string;
  result: "card" | "buyback";
  card: ReturnType<typeof Gacha.nftCard> | null;
  buybackUsd: number | null;
  signature: string | null;
};
const MAX_GIFT_PACKS = 20;

// Submitting a pack failed after signing, so it may or may not be paid.
class UncertainPackError extends Error {
  constructor(
    message: string,
    readonly memo: string,
    readonly signature: string
  ) {
    super(message);
  }
}

export class GachaCommand {
  public static register(program: Command): void {
    const gacha = program
      .command("gacha")
      .description("Gacha packs, collectibles and marketplace");
    gacha
      .command("packs")
      .description("Browse gacha packs, or one pack's odds and cards")
      .option("--pack <code>", "Pack code for detail (e.g. pokemon_50)")
      .option("--limit <n>", "Max cards to show for --pack", "10")
      .action((opts) => this.packs(opts));
    gacha
      .command("open")
      .description("Buy and open a pack, or open a gifted one")
      .requiredOption("--pack <code>", "Pack code (e.g. pokemon_50)")
      .option(
        "--quantity <n>",
        `Packs to buy (1-${MAX_PACKS_PER_RUN}, default 1)`
      )
      .option("--turbo", "Instantly sell commons back for USDC")
      .option("--gifted", "Open a pack you were gifted or awarded")
      .option("--memo <memo>", "Open an already-bought pack by its memo")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    gacha
      .command("buyback")
      .description("Sell a pulled card back for USDC")
      .requiredOption("--mint <mint>", "Card mint address")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.buyback(opts));
    gacha
      .command("gift")
      .description("Gift packs to another wallet")
      .requiredOption("--pack <code>", "Pack code (e.g. pokemon_50)")
      .requiredOption("--to <address>", "Recipient wallet address")
      .option("--quantity <n>", `Packs to gift (1-${MAX_GIFT_PACKS})`, "1")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.gift(opts));
    gacha
      .command("collection")
      .description("View a wallet's cards and unopened packs")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.collection(opts));
    gacha
      .command("activity")
      .description("View a wallet's pulls and marketplace trades")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--limit <n>", "Max results per list", "20")
      .action((opts) => this.activity(opts));
    gacha
      .command("verify")
      .description("Verify a pull's VRF proof")
      .requiredOption("--memo <memo>", "Pull memo from gacha activity")
      .action((opts) => this.verify(opts));
    gacha
      .command("winners")
      .description("Recent pulls across all packs")
      .option("--pack <code>", "Only pulls from this pack")
      .option("--epic", "Only epic pulls")
      .option("--limit <n>", "Max results (up to 200)", "10")
      .action((opts) => this.winners(opts));
    gacha
      .command("leaderboard")
      .description("Weekly gacha leaderboard")
      .option("--season <n>", "Season number (defaults to the current week)")
      .option("--limit <n>", "Max results", "10")
      .option("--key <name>", "Also show this key's standing")
      .option("--address <address>", "Also show this wallet's standing")
      .action((opts) => this.leaderboard(opts));
    GachaMarketCommand.register(gacha);
    GachaShippingCommand.register(gacha);
  }

  public static async resolveAddress(opts: {
    key?: string;
    address?: string;
  }): Promise<string> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    if (opts.address && !isAddress(opts.address)) {
      throw new Error("Invalid --address.");
    }
    return (
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey))
    );
  }

  private static async findPack(code: string): Promise<Machine> {
    const machines = await GachaClient.getMachines();
    const machine = machines.find((m) => m.code === code);
    if (!machine) {
      throw new Error(
        `Unknown pack "${code}". Run \`jup gacha packs\` to list packs.`
      );
    }
    return machine;
  }

  private static parseCount(value: string, max: number, flag: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      throw new Error(`${flag} must be an integer from 1 to ${max}.`);
    }
    return n;
  }

  private static async packs(opts: {
    pack?: string;
    limit: string;
  }): Promise<void> {
    if (opts.pack) {
      const machine = await this.findPack(opts.pack);
      const cards = await GachaClient.getMachineCards(machine.code, {
        page: 1,
        limit: Number(opts.limit),
      });
      const detail = {
        ...Gacha.packSummary(machine),
        tiers: Gacha.packTiers(machine),
        cards: cards.map((c) => Gacha.nftCard(c)),
      };
      if (Output.isJson()) {
        Output.json({ pack: detail });
        return;
      }
      Output.table({
        type: "vertical",
        rows: [
          { label: "Pack", value: detail.pack },
          { label: "Name", value: detail.name },
          { label: "Category", value: detail.category ?? "—" },
          {
            label: "Price",
            value: Output.formatDollar(detail.priceUsd, { decimals: 2 }),
          },
          {
            label: "Expected Value",
            value: Output.formatDollar(detail.evUsd, { decimals: 2 }),
          },
          {
            label: "Buyback",
            value: detail.buybackPct ? `${detail.buybackPct}%` : "—",
          },
          { label: "Turbo", value: Output.formatBoolean(detail.turbo) },
        ],
      });
      Output.table({
        type: "horizontal",
        headers: {
          rarity: "Rarity",
          odds: "Odds",
          range: "Value Range",
          stock: "Stock",
        },
        rows: detail.tiers.map((t) => ({
          ...t,
          odds: `${t.oddsPct}%`,
          range: `${Output.formatDollar(t.minValueUsd ?? 0, { decimals: 0 })} – ${Output.formatDollar(t.maxValueUsd ?? 0, { decimals: 0 })}`,
        })),
      });
      Output.table({
        type: "horizontal",
        headers: {
          name: "Card",
          rarity: "Rarity",
          grade: "Grade",
          value: "Value",
          mint: "Mint",
        },
        rows: detail.cards.map((c) => ({
          ...c,
          value: Output.formatDollar(c.valueUsd ?? 0, { decimals: 0 }),
        })),
        maxWidths: { name: 40 },
      });
      return;
    }

    const machines = await GachaClient.getMachines();
    const packs = machines
      .filter((m) => m.metadata?.public)
      .sort((a, b) => a.priceNumber - b.priceNumber)
      .map((m) => Gacha.packSummary(m));
    if (Output.isJson()) {
      Output.json({ packs });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        pack: "Pack",
        name: "Name",
        category: "Category",
        price: "Price",
        ev: "Expected Value",
        inStock: "In Stock",
      },
      rows: packs.map((p) => ({
        ...p,
        price: Output.formatDollar(p.priceUsd, { decimals: 0 }),
        ev: Output.formatDollar(p.evUsd, { decimals: 2 }),
        inStock: Output.formatBoolean(p.inStock),
      })),
    });
  }

  private static pullFromResult(memo: string, res: OpenPackResult): Pull {
    if (res.result.type === "turbo-mode-buyback") {
      return {
        memo,
        result: "buyback",
        card: res.result.nft ? Gacha.nftCard(res.result.nft) : null,
        buybackUsd: Number(res.result.amount),
        signature: null,
      };
    }
    return {
      memo,
      result: "card",
      card: Gacha.nftCard(res.result.nft),
      buybackUsd: null,
      signature: res.result.transactionSignature ?? null,
    };
  }

  private static async open(opts: {
    pack: string;
    quantity?: string;
    turbo?: boolean;
    gifted?: boolean;
    memo?: string;
    key?: string;
  }): Promise<void> {
    if (opts.gifted && opts.memo) {
      throw new Error("--gifted cannot be combined with --memo.");
    }
    if (opts.memo && opts.quantity !== undefined) {
      throw new Error("--quantity cannot be combined with --memo.");
    }
    const quantity = this.parseCount(
      opts.quantity ?? "1",
      MAX_PACKS_PER_RUN,
      "--quantity"
    );
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const machine = await this.findPack(opts.pack);

    if (opts.memo) {
      if (Config.dryRun) {
        throw new Error(
          "--memo opens an already-paid pack; nothing to preview."
        );
      }
      const pull = this.pullFromResult(
        opts.memo,
        await GachaClient.openPack(opts.memo)
      );
      return this.printPulls(machine, signer.address, [pull]);
    }

    if (opts.gifted) {
      const unopened = (await GachaClient.getUnopenedPacks(signer.address))[
        machine.code
      ];
      if (!unopened || unopened < quantity) {
        throw new Error(
          `${unopened ?? 0} gifted ${machine.code} packs available to open.`
        );
      }
      if (Config.dryRun) {
        return this.printDryRun({
          pack: machine.code,
          address: signer.address,
          gifted: true,
          quantity,
          unopened,
        });
      }
      return this.openEach(
        machine,
        signer.address,
        quantity,
        true,
        async () => {
          const challenge = await GachaClient.generateGiftedPackChallenge({
            publicKey: signer.address,
            packType: machine.code,
          });
          const signature = await signer.signMessage(challenge.messageToSign);
          const { memo } = await GachaClient.useGiftedPack({
            publicKey: signer.address,
            packType: machine.code,
            nonce: challenge.nonce,
            ...(opts.turbo && { turbo: true }),
            signedMessage: challenge.messageToSign,
            signature: getBase58Decoder().decode(signature),
          });
          return { memo, signature: null };
        }
      );
    }

    const generate = () =>
      GachaClient.generatePack({
        playerAddress: signer.address,
        packType: machine.code,
        ...(opts.turbo && { turbo: true }),
      });

    if (Config.dryRun) {
      const purchases = [];
      for (let i = 0; i < quantity; i++) {
        purchases.push(await generate());
      }
      return this.printDryRun({
        pack: machine.code,
        address: signer.address,
        quantity,
        costUsd: machine.priceNumber * quantity,
        memos: purchases.map((p) => p.memo),
        transactions: purchases.map((p) => p.transaction),
      });
    }

    // Each pack is built and signed right before it is submitted so its
    // blockhash is still fresh.
    return this.openEach(machine, signer.address, quantity, false, async () => {
      const { memo, transaction } = await generate();
      const signed = await signer.signTransaction(
        transaction as Base64EncodedBytes
      );
      const signature = Signer.signatureOf(signed);
      try {
        const submitted = await GachaClient.submitPack(signed);
        return { memo, signature: submitted.signature ?? signature };
      } catch (err) {
        throw new UncertainPackError(
          await Output.errorMessage(err),
          memo,
          signature
        );
      }
    });
  }

  // Opens packs one at a time and stops at the first failure, still printing
  // the pulls that completed so paid packs are never silently lost.
  private static async openEach(
    machine: Machine,
    address: string,
    quantity: number,
    gifted: boolean,
    acquire: () => Promise<{ memo: string; signature: string | null }>
  ): Promise<void> {
    const pulls: Pull[] = [];
    for (let i = 0; i < quantity; i++) {
      const packsLeft = quantity - i - 1;
      let pack: { memo: string; signature: string | null };
      try {
        pack = await acquire();
      } catch (err) {
        if (!(err instanceof UncertainPackError) && pulls.length === 0) {
          throw err;
        }
        return this.printPulls(machine, address, pulls, {
          stage: err instanceof UncertainPackError ? "submit" : "buy",
          memo: err instanceof UncertainPackError ? err.memo : null,
          signature: err instanceof UncertainPackError ? err.signature : null,
          error: await Output.errorMessage(err),
          packsLeft:
            err instanceof UncertainPackError ? packsLeft : packsLeft + 1,
          gifted,
        });
      }
      try {
        const pull = this.pullFromResult(
          pack.memo,
          await GachaClient.openPack(pack.memo)
        );
        pulls.push({ ...pull, signature: pull.signature ?? pack.signature });
      } catch (err) {
        return this.printPulls(machine, address, pulls, {
          stage: "open",
          memo: pack.memo,
          signature: pack.signature,
          error: await Output.errorMessage(err),
          packsLeft,
          gifted,
        });
      }
    }
    this.printPulls(machine, address, pulls);
  }

  private static printDryRun(data: {
    pack: string;
    address: string;
    quantity: number;
    gifted?: boolean;
    unopened?: number;
    costUsd?: number;
    memos?: string[];
    transactions?: string[];
  }): void {
    if (Output.isJson()) {
      Output.json({ dryRun: true, ...data });
      return;
    }
    console.log(Output.DRY_RUN_LABEL);
    Output.table({
      type: "vertical",
      rows: [
        { label: "Pack", value: data.pack },
        { label: "Quantity", value: String(data.quantity) },
        ...(data.gifted
          ? [{ label: "Gifted Packs", value: String(data.unopened) }]
          : [
              {
                label: "Cost",
                value: Output.formatDollar(data.costUsd, { decimals: 2 }),
              },
              { label: "Memos", value: (data.memos ?? []).join("\n") },
            ]),
      ],
    });
  }

  private static printPulls(
    machine: Machine,
    address: string,
    pulls: Pull[],
    failure?: OpenFailure
  ): void {
    const failed = failure && {
      stage: failure.stage,
      memo: failure.memo,
      signature: failure.signature,
      error: failure.error,
      retry: Gacha.retryOpenCommand(machine.code, failure),
      packsNotOpened: failure.packsLeft,
    };
    if (failure) {
      process.exitCode = 1;
    }
    if (Output.isJson()) {
      Output.json({
        pack: machine.code,
        address,
        pulls,
        ...(failed && { failed }),
      });
      return;
    }
    if (pulls.length > 0) {
      Output.table({
        type: "horizontal",
        headers: {
          name: "Card",
          rarity: "Rarity",
          value: "Value",
          result: "Result",
          signature: "Tx Signature",
        },
        rows: pulls.map((p) => ({
          name: p.card?.name ?? "—",
          rarity: p.card?.rarity ?? "—",
          value: Output.formatDollar(p.card?.valueUsd ?? 0, { decimals: 2 }),
          result:
            p.result === "buyback"
              ? `sold for ${Output.formatDollar(p.buybackUsd ?? 0, { decimals: 2 })}`
              : "kept",
          signature: p.signature ?? "—",
        })),
        maxWidths: { name: 40 },
      });
    }
    if (failure) {
      console.log(
        `${chalk.red.bold("Error:")} ${Gacha.describeOpenFailure(machine.code, failure)}`
      );
    }
  }

  private static async buyback(opts: {
    mint: string;
    key?: string;
  }): Promise<void> {
    if (!isAddress(opts.mint)) {
      throw new Error("Invalid --mint.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const [offer, found] = await Promise.all([
      GachaClient.getBuybackOffer(signer.address, opts.mint),
      GachaClient.browse({ page: 1, step: 1, search: opts.mint }),
    ]);
    if (!offer.available) {
      throw new Error(
        "This card has no buyback offer for this wallet. Buybacks are only offered on recent pulls."
      );
    }
    // The offer is keyed to the pull, so it outlives the card being moved.
    const owner = found.filterNFtCard[0]?.owner?.wallet;
    if (owner && owner !== signer.address) {
      throw new Error(`Card ${opts.mint} is no longer in ${signer.address}.`);
    }
    const { transaction, refundAmount } = await GachaClient.generateBuyback({
      playerAddress: signer.address,
      nftAddress: opts.mint,
    });
    const amountUsd = Number(refundAmount ?? offer.amount);

    let signature: string | null = null;
    if (!Config.dryRun) {
      const signed = await signer.signTransaction(
        transaction as Base64EncodedBytes
      );
      signature = await this.submitSigned(signed, (tx) =>
        GachaClient.submitBuyback(tx)
      );
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        mint: opts.mint,
        address: signer.address,
        amountUsd,
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
        { label: "Card", value: opts.mint },
        {
          label: "Buyback",
          value: Output.formatDollar(amountUsd, { decimals: 2 }),
        },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  // The API's signature is optional; the signed transaction's own signature
  // is the same transaction id.
  private static async submitSigned(
    signed: Base64EncodedWireTransaction,
    submit: (signed: string) => Promise<{ signature?: string }>
  ): Promise<string> {
    const signature = Signer.signatureOf(signed);
    const res = await submit(signed).catch(async (err: unknown) => {
      throw await Output.unconfirmedTxError(err, signature);
    });
    return res.signature || signature;
  }

  private static async gift(opts: {
    pack: string;
    to: string;
    quantity: string;
    key?: string;
  }): Promise<void> {
    if (!isAddress(opts.to)) {
      throw new Error("Invalid --to address.");
    }
    const quantity = this.parseCount(
      opts.quantity,
      MAX_GIFT_PACKS,
      "--quantity"
    );
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    if (opts.to === signer.address) {
      throw new Error("Cannot gift packs to yourself.");
    }
    const machine = await this.findPack(opts.pack);
    const gift = await GachaClient.generateGift({
      sender: signer.address,
      receiver: opts.to,
      packType: machine.code,
      count: quantity,
    });

    let signature: string | null = null;
    if (!Config.dryRun) {
      const signed = await signer.signTransaction(
        gift.transaction as Base64EncodedBytes
      );
      signature = await this.submitSigned(signed, (tx) =>
        GachaClient.submitPack(tx)
      );
    }

    const costUsd =
      gift.totalCost !== undefined
        ? Number(gift.totalCost)
        : machine.priceNumber * quantity;
    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        giftId: gift.giftId !== undefined ? String(gift.giftId) : null,
        pack: machine.code,
        quantity,
        from: signer.address,
        to: opts.to,
        costUsd,
        signature,
        ...(Config.dryRun && { transaction: gift.transaction }),
      });
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Pack", value: `${quantity} x ${machine.name}` },
        { label: "To", value: opts.to },
        { label: "Cost", value: Output.formatDollar(costUsd, { decimals: 2 }) },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  private static async collection(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await this.resolveAddress(opts);
    const [first, unopened] = await Promise.all([
      GachaClient.getOwnedCards(address, 1),
      GachaClient.getUnopenedPacks(address),
    ]);
    const pages = [first];
    for (let page = 2; page <= (first.totalPages ?? 1); page++) {
      pages.push(await GachaClient.getOwnedCards(address, page));
    }
    const cards = pages
      .flatMap((p) => p.filterNFtCard)
      .map((c) => {
        const { owner: _owner, ...card } = Gacha.listing(c);
        return card;
      });
    const packs = Object.entries(unopened)
      .filter(([, count]) => count > 0)
      .map(([pack, count]) => ({ pack, count }));
    const insuredValueUsd = cards.reduce(
      (sum, c) => sum + (c.insuredValueUsd ?? 0),
      0
    );

    if (Output.isJson()) {
      Output.json({
        address,
        cardCount: cards.length,
        insuredValueUsd,
        cards,
        packs,
      });
      return;
    }
    console.log(
      `${cards.length} cards, insured value ${Output.formatDollar(insuredValueUsd, { decimals: 2 })}`
    );
    Output.table({
      type: "horizontal",
      headers: {
        name: "Card",
        grade: "Grade",
        value: "Insured Value",
        status: "Status",
        mint: "Mint",
      },
      rows: cards.map((c) => ({
        ...c,
        value: Output.formatDollar(c.insuredValueUsd ?? 0, { decimals: 0 }),
        status:
          c.status === "listed"
            ? `listed @ ${c.price} ${c.currency}`
            : c.status,
      })),
      maxWidths: { name: 40 },
    });
    if (packs.length > 0) {
      console.log(chalk.bold("Unopened packs"));
      Output.table({
        type: "horizontal",
        headers: { pack: "Pack", count: "Count" },
        rows: packs,
      });
    }
  }

  private static async activity(opts: {
    key?: string;
    address?: string;
    limit: string;
  }): Promise<void> {
    const address = await this.resolveAddress(opts);
    const limit = Number(opts.limit);
    const [pullRecords, tradeRecords] = await Promise.all([
      GachaClient.getPulls(address, limit),
      GachaClient.getCardActivity(address),
    ]);
    const pulls = pullRecords.slice(0, limit).map((p) => ({
      memo: p.memo,
      at: p.spin_txn_created_at,
      costUsd: p.spin_cost,
      status: p.spin_status,
      mint: p.send_nft_address,
      name: p.hashlist_metadata?.content?.metadata?.name ?? null,
      roll: p.send_nft_roll,
      buybackUsd:
        p.buyback_refund_amount !== null
          ? NumberConverter.fromMicroUsd(p.buyback_refund_amount)
          : null,
      signature: p.spin_txn_signature,
    }));
    const trades = tradeRecords.slice(0, limit).map((t) => Gacha.trade(t));

    if (Output.isJson()) {
      Output.json({ address, pulls, trades });
      return;
    }
    console.log(chalk.bold("Pulls"));
    Output.table({
      type: "horizontal",
      headers: {
        at: "Time",
        cost: "Cost",
        name: "Card",
        buyback: "Buyback",
        memo: "Memo",
      },
      rows: pulls.map((p) => ({
        ...p,
        at: new Date(p.at).toLocaleString(),
        cost: Output.formatDollar(p.costUsd, { decimals: 0 }),
        buyback: Output.formatDollar(p.buybackUsd ?? 0, { decimals: 2 }),
      })),
    });
    console.log(chalk.bold("Marketplace"));
    Output.table({
      type: "horizontal",
      headers: {
        at: "Time",
        action: "Action",
        name: "Card",
        price: "Price",
        signature: "Tx Signature",
      },
      rows: trades.map((t) => ({
        ...t,
        at: t.at ? new Date(t.at).toLocaleString() : "—",
        price: Output.formatDollar(t.priceUsd ?? 0, { decimals: 2 }),
      })),
      maxWidths: { name: 40, signature: 30 },
    });
  }

  private static async verify(opts: { memo: string }): Promise<void> {
    const res = await GachaClient.verifyVrf(opts.memo);
    const result = {
      memo: res.memo ?? opts.memo,
      valid: res.valid ?? false,
      rollMatches: res.rollMatches ?? null,
      actualRoll: res.actualRoll ?? null,
      calculatedRoll: res.calculatedRoll ?? null,
      address: res.wallet ?? null,
      mint: res.nftAddress ?? null,
      card: res.nftMetadata?.content?.metadata?.name ?? null,
      turbo: res.turboMode ?? null,
      algorithm: res.algorithm ?? null,
      vrfMode: res.vrfMode ?? null,
      publicKey: res.publicKey ?? null,
      proof: res.proof ?? null,
      signature: res.transactionSignature ?? null,
    };
    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Memo", value: result.memo },
        { label: "Valid", value: Output.formatBoolean(result.valid) },
        {
          label: "Roll",
          value: `${result.actualRoll ?? "—"} (recomputed ${result.calculatedRoll ?? "—"})`,
        },
        { label: "Card", value: result.card ?? "—" },
        { label: "Mint", value: result.mint ?? "—" },
        { label: "Wallet", value: result.address ?? "—" },
        { label: "Algorithm", value: result.algorithm ?? "—" },
        { label: "Tx Signature", value: result.signature ?? "—" },
      ],
    });
  }

  private static async winners(opts: {
    pack?: string;
    epic?: boolean;
    limit: string;
  }): Promise<void> {
    const limit = Number(opts.limit);
    const winners = (
      await GachaClient.getWinners({
        count: Math.min(Math.max(limit, 10), 200),
        packType: opts.pack,
        epic: opts.epic,
      })
    )
      .slice(0, limit)
      .map((w) => ({
        address: w.wallet,
        pack: w.machineCode,
        mint: w.nftId,
        name: w.nftName,
        rarity: w.rarity,
        valueUsd: Number(w.value),
        openedAt: w.openedAt,
      }));
    if (Output.isJson()) {
      Output.json({ winners });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        openedAt: "Time",
        pack: "Pack",
        name: "Card",
        rarity: "Rarity",
        value: "Value",
        address: "Wallet",
      },
      rows: winners.map((w) => ({
        ...w,
        openedAt: new Date(w.openedAt).toLocaleString(),
        value: Output.formatDollar(w.valueUsd, { decimals: 0 }),
      })),
      maxWidths: { name: 36 },
    });
  }

  private static async leaderboard(opts: {
    season?: string;
    limit: string;
    key?: string;
    address?: string;
  }): Promise<void> {
    const seasons = await GachaClient.getLeaderboardSeasons();
    const selected = opts.season
      ? seasons.find((s) => s.season === Number(opts.season))
      : (seasons.find((s) => s.state === "ongoing") ??
        seasons.findLast((s) => s.state === "completed") ??
        seasons[0]);
    if (!selected) {
      throw new Error(
        opts.season ? `Unknown season ${opts.season}.` : "No seasons found."
      );
    }
    const wantsStanding = Boolean(opts.key || opts.address);
    const [entries, me] = await Promise.all([
      GachaClient.getLeaderboard({
        season: selected.season,
        limit: Number(opts.limit),
      }),
      wantsStanding
        ? this.resolveAddress(opts).then((wallet) =>
            GachaClient.getLeaderboardEntry({
              wallet,
              season: selected.season,
            }).then((res) => ({ address: wallet, ...res }))
          )
        : Promise.resolve(null),
    ]);
    const toEntry = (e: (typeof entries)[number]) => ({
      rank: e.rank,
      address: e.wallet,
      volumeUsd: e.volumeUsd,
      prize: e.prize
        ? { pack: e.prize.packType, packs: e.prize.rewardPacks }
        : null,
    });

    const json = {
      season: {
        season: selected.season,
        state: selected.state,
        startAt: selected.startAt,
        endAt: selected.endAt,
        minVolumeUsd: selected.rewards?.minVolumeUsd ?? null,
        prizes: (selected.rewards?.prizeBands ?? []).map((b) => ({
          fromRank: b.fromRank,
          toRank: b.toRank,
          pack: b.packType,
          packs: b.rewardPacks,
        })),
      },
      seasons: seasons.map((s) => ({
        season: s.season,
        state: s.state,
        startAt: s.startAt,
        endAt: s.endAt,
      })),
      entries: entries.map(toEntry),
      ...(me && {
        me: {
          address: me.address,
          entry: me.entry ? toEntry(me.entry) : null,
          claimState: me.claimState,
        },
      }),
    };
    if (Output.isJson()) {
      Output.json(json);
      return;
    }
    console.log(
      chalk.bold(
        `Season ${selected.season} (${selected.state}): ${new Date(selected.startAt).toLocaleDateString()} — ${new Date(selected.endAt).toLocaleDateString()}`
      )
    );
    Output.table({
      type: "horizontal",
      headers: {
        rank: "Rank",
        address: "Wallet",
        volume: "Volume",
        prize: "Prize",
      },
      rows: json.entries.map((e) => ({
        ...e,
        volume: Output.formatDollar(e.volumeUsd, { decimals: 0 }),
        prize: e.prize ? `${e.prize.packs} x ${e.prize.pack}` : "—",
      })),
    });
    if (json.me) {
      console.log(
        json.me.entry
          ? `${json.me.address}: rank ${json.me.entry.rank}, ${Output.formatDollar(json.me.entry.volumeUsd, { decimals: 0 })} (${json.me.claimState})`
          : `${json.me.address}: unranked`
      );
    }
  }
}
