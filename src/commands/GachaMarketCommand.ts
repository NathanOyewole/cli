import { isAddress, type Base64EncodedBytes } from "@solana/kit";
import type { Command } from "commander";

import { GachaClient, type MarketplaceCard } from "../clients/GachaClient.ts";
import { Config } from "../lib/Config.ts";
import { Gacha, MARKETPLACE_SORTS } from "../lib/Gacha.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";

export class GachaMarketCommand {
  public static register(gacha: Command): void {
    gacha
      .command("marketplace")
      .description("Search marketplace listings")
      .option("--search <query>", "Search by card name or mint")
      .option(
        "--sort <sort>",
        `Sort: ${Object.keys(MARKETPLACE_SORTS).join(", ")}`,
        "list-date-desc"
      )
      .option("--category <list>", "Comma-separated categories (e.g. Pokemon)")
      .option(
        "--grading-company <list>",
        "Comma-separated grading companies (e.g. PSA,CGC)"
      )
      .option("--min-price <usd>", "Minimum list price")
      .option("--max-price <usd>", "Maximum list price")
      .option("--min-grade <n>", "Minimum numeric grade (1-10)")
      .option("--max-grade <n>", "Maximum numeric grade (1-10)")
      .option("--limit <n>", "Results per page", "20")
      .option("--page <n>", "Page number", "1")
      .action((opts) => this.marketplace(opts));
    gacha
      .command("card")
      .description("View a card's details and listing")
      .requiredOption("--mint <mint>", "Card mint address")
      .action((opts) => this.card(opts));
    gacha
      .command("buy")
      .description("Buy a listed card")
      .requiredOption("--mint <mint>", "Card mint address")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.buy(opts));
    gacha
      .command("list")
      .description("List a card for sale, or change its price")
      .requiredOption("--mint <mint>", "Card mint address")
      .requiredOption("--price <usd>", "List price in USDC")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.list(opts));
    gacha
      .command("delist")
      .description("Cancel a card listing")
      .requiredOption("--mint <mint>", "Card mint address")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.delist(opts));
  }

  private static async marketplace(opts: {
    search?: string;
    sort: string;
    category?: string;
    gradingCompany?: string;
    minPrice?: string;
    maxPrice?: string;
    minGrade?: string;
    maxGrade?: string;
    limit: string;
    page: string;
  }): Promise<void> {
    const orderBy = MARKETPLACE_SORTS[opts.sort];
    if (!orderBy) {
      throw new Error(
        `Invalid --sort. Must be one of: ${Object.keys(MARKETPLACE_SORTS).join(", ")}.`
      );
    }
    const page = Number(opts.page);
    const num = (v?: string) => (v === undefined ? undefined : Number(v));
    const res = await GachaClient.browse({
      page,
      step: Number(opts.limit),
      search: opts.search?.trim() || undefined,
      // The browse endpoint spans the whole catalog; a near-zero floor keeps
      // it to cards that are actually listed.
      listPriceMin: num(opts.minPrice) ?? 0.01,
      listPriceMax: num(opts.maxPrice),
      genericGradeMin: num(opts.minGrade),
      genericGradeMax: num(opts.maxGrade),
      categories: opts.category,
      gradingCompany: opts.gradingCompany,
      orderBy,
    });
    const listings = res.filterNFtCard.map((c) => Gacha.listing(c));

    if (Output.isJson()) {
      Output.json({
        total: res.findTotal ?? listings.length,
        page,
        totalPages: res.totalPages ?? 1,
        listings,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        name: "Card",
        grade: "Grade",
        price: "Price",
        insured: "Insured Value",
        mint: "Mint",
      },
      rows: listings.map((l) => ({
        ...l,
        price: `${l.price} ${l.currency}`,
        insured: Output.formatDollar(l.insuredValueUsd ?? 0, { decimals: 0 }),
      })),
      maxWidths: { name: 40 },
    });
    console.log(`Page ${page} of ${res.totalPages ?? 1}`);
  }

  private static async findListing(mint: string): Promise<MarketplaceCard> {
    if (!isAddress(mint)) {
      throw new Error("Invalid --mint.");
    }
    const res = await GachaClient.browse({ page: 1, step: 1, search: mint });
    const card = res.filterNFtCard.find((c) => c.nftAddress === mint);
    if (!card) {
      throw new Error(`Card ${mint} not found on the marketplace.`);
    }
    return card;
  }

  private static async card(opts: { mint: string }): Promise<void> {
    const [raw, detail] = await Promise.all([
      this.findListing(opts.mint),
      GachaClient.getCard(opts.mint),
    ]);
    const listing = Gacha.listing(raw);
    const card = {
      ...listing,
      year: detail.year ? Number(detail.year) : null,
      set: detail.set ?? null,
      gradingId: detail.gradingID ?? null,
      frontImage: detail.frontImage ?? null,
      backImage: detail.backImage ?? null,
    };
    if (Output.isJson()) {
      Output.json(card);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Card", value: card.name },
        { label: "Mint", value: card.mint },
        { label: "Category", value: card.category ?? "—" },
        { label: "Set", value: card.set ?? "—" },
        { label: "Year", value: card.year ? String(card.year) : "—" },
        { label: "Grade", value: card.grade ?? "—" },
        {
          label: "Insured Value",
          value: Output.formatDollar(card.insuredValueUsd ?? 0, {
            decimals: 2,
          }),
        },
        { label: "Owner", value: card.owner ?? "—" },
        {
          label: "Status",
          value:
            card.status === "listed"
              ? `listed @ ${card.price} ${card.currency}`
              : card.status,
        },
        ...(card.frontImage
          ? [{ label: "Image", value: card.frontImage }]
          : []),
      ],
    });
  }

  private static async signAndBroadcast(
    signer: Signer,
    transactions: string[],
    mint: string
  ): Promise<string | null> {
    let signature: string | null = null;
    for (const tx of transactions) {
      const signed = await signer.signTransaction(tx as Base64EncodedBytes);
      const res = await GachaClient.broadcast({
        wallet: signer.address,
        signedTransaction: signed,
        nftAddress: mint,
      });
      if (res.success === false) {
        throw new Error(res.message ?? "Transaction failed to broadcast.");
      }
      signature = res.signature ?? signature;
    }
    return signature;
  }

  private static async execute(
    signer: Signer,
    action: "buy" | "list" | "update-listing" | "cancel-listing",
    body: Record<string, unknown>,
    mint: string
  ): Promise<{ transactions: string[]; signature: string | null }> {
    const transactions = Gacha.parseTransactions(
      await GachaClient.buildMarketplaceTx(action, body)
    );
    if (transactions.length === 0) {
      throw new Error("Marketplace returned no transaction.");
    }
    const signature = Config.dryRun
      ? null
      : await this.signAndBroadcast(signer, transactions, mint);
    return { transactions, signature };
  }

  private static print(
    result: Record<string, unknown> & {
      transactions: string[];
      signature: string | null;
    },
    rows: { label: string; value: string }[]
  ): void {
    const { transactions, ...rest } = result;
    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        ...rest,
        ...(Config.dryRun && { transactions }),
      });
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        ...rows,
        ...(result.signature
          ? [{ label: "Tx Signature", value: result.signature }]
          : []),
      ],
    });
  }

  private static async buy(opts: { mint: string; key?: string }) {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const listing = Gacha.listing(await this.findListing(opts.mint));
    if (listing.status !== "listed" || listing.price === null) {
      throw new Error(`Card ${opts.mint} is not listed for sale.`);
    }
    if (listing.owner === signer.address) {
      throw new Error("You already own this card.");
    }
    const res = await this.execute(
      signer,
      "buy",
      {
        wallet: signer.address,
        nftAddress: opts.mint,
        price: listing.price,
        currency: listing.currency,
        ...(listing.owner && { sellerWallet: listing.owner }),
      },
      opts.mint
    );
    this.print(
      {
        action: "buy",
        mint: opts.mint,
        name: listing.name,
        price: listing.price,
        currency: listing.currency,
        seller: listing.owner,
        ...res,
      },
      [
        { label: "Card", value: listing.name },
        { label: "Price", value: `${listing.price} ${listing.currency}` },
        { label: "Seller", value: listing.owner ?? "—" },
      ]
    );
  }

  private static async list(opts: {
    mint: string;
    price: string;
    key?: string;
  }) {
    const price = Number(opts.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("--price must be a positive number.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const listing = Gacha.listing(await this.findListing(opts.mint));
    if (listing.owner !== signer.address) {
      throw new Error(`Card ${opts.mint} is not owned by ${signer.address}.`);
    }
    if (listing.status === "shipping") {
      throw new Error("Card is being shipped and can't be listed.");
    }
    const isUpdate = listing.status === "listed";
    const res = isUpdate
      ? await this.execute(
          signer,
          "update-listing",
          {
            wallet: signer.address,
            tokenMint: opts.mint,
            newPrice: price,
            coin: "USDC",
          },
          opts.mint
        )
      : await this.execute(
          signer,
          "list",
          {
            wallet: signer.address,
            cardId: listing.cardId,
            nftAddress: opts.mint,
            price,
            currency: "USDC",
          },
          opts.mint
        );
    this.print(
      {
        action: isUpdate ? "update" : "list",
        mint: opts.mint,
        name: listing.name,
        price,
        currency: "USDC",
        ...res,
      },
      [
        { label: "Card", value: listing.name },
        { label: "Price", value: `${price} USDC` },
        { label: "Action", value: isUpdate ? "update price" : "list" },
      ]
    );
  }

  private static async delist(opts: { mint: string; key?: string }) {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const listing = Gacha.listing(await this.findListing(opts.mint));
    if (listing.status !== "listed") {
      throw new Error(`Card ${opts.mint} is not listed.`);
    }
    if (listing.owner !== signer.address) {
      throw new Error(`Card ${opts.mint} is not listed by ${signer.address}.`);
    }
    const res = await this.execute(
      signer,
      "cancel-listing",
      { wallet: signer.address, tokenMint: opts.mint },
      opts.mint
    );
    this.print(
      { action: "delist", mint: opts.mint, name: listing.name, ...res },
      [{ label: "Card", value: listing.name }]
    );
  }
}
