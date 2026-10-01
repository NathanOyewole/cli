import type {
  CardActivity,
  Machine,
  MarketplaceCard,
  NftAttribute,
  Rarity,
  TcgNft,
} from "../clients/GachaClient.ts";

const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic"];

export const MARKETPLACE_SORTS: Record<string, string> = {
  "list-date-desc": "listedDateDesc",
  "list-date-asc": "listedDateAsc",
  "list-price-asc": "listedPriceAsc",
  "list-price-desc": "listedPriceDesc",
  "insured-asc": "priceAsc",
  "insured-desc": "priceDesc",
  "name-asc": "nameAsc",
  "name-desc": "nameDesc",
  "year-asc": "yearAsc",
  "year-desc": "yearDesc",
  newest: "dateDesc",
  oldest: "dateAsc",
};

export class Gacha {
  public static packSummary(m: Machine) {
    return {
      pack: m.code,
      name: m.name,
      category: m.metadata?.menuCategory ?? null,
      priceUsd: m.priceNumber,
      evUsd: m.evNumber,
      buybackPct: m.instantBuybackNumber ?? null,
      cardsPerPack: m.contains,
      turbo: m.metadata?.turboMode ?? false,
      inStock: RARITIES.some((r) => (m.stock[r] ?? 0) > 0),
    };
  }

  public static packTiers(m: Machine) {
    return RARITIES.filter((r) => m.odds[r] !== undefined).map((rarity) => ({
      rarity,
      oddsPct: round((m.odds[rarity] ?? 0) * 100, 4),
      minValueUsd: m.tierRanges?.[rarity]?.start ?? null,
      maxValueUsd: m.tierRanges?.[rarity]?.end ?? null,
      stock: m.stock[rarity] ?? 0,
    }));
  }

  public static nftCard(nft: TcgNft) {
    return {
      mint: nft.id,
      name: nft.name,
      rarity: nft.rarity ?? null,
      grade: this.gradeLine(nft.attributes) ?? nft.grade ?? null,
      valueUsd: toNumber(
        nft.value ?? nft.estimatedValue ?? attr(nft.attributes, "Insured Value")
      ),
    };
  }

  public static listing(raw: MarketplaceCard) {
    const marketplace = (raw.listing?.marketplace ?? "").trim().toUpperCase();
    return {
      mint: raw.nftAddress,
      cardId: raw.id,
      name: raw.itemName,
      category: raw.category || null,
      grade: [raw.gradingCompany, raw.grade].filter(Boolean).join(" ") || null,
      insuredValueUsd: toNumber(raw.insuredValue),
      status: raw.burnId ? "shipping" : raw.listing ? "listed" : "unlisted",
      price: raw.listing ? toNumber(raw.listing.price) : null,
      currency: raw.listing
        ? this.listingCurrency(raw.listing.currency, marketplace)
        : null,
      marketplace: marketplace || null,
      owner: raw.owner?.wallet ?? null,
      listedAt: raw.listing?.createdAt ?? null,
    };
  }

  public static listingCurrency(
    raw: string | undefined,
    marketplace: string
  ): string {
    const c = (raw ?? "").trim().toUpperCase();
    if (c === "SOL" || c === "WSOL" || c === "SOLANA") {
      return "SOL";
    }
    if (c) {
      return c;
    }
    // Magic Eden listings omit the currency and are priced in SOL.
    return marketplace === "ME" || marketplace === "MAGIC_EDEN"
      ? "SOL"
      : "USDC";
  }

  public static trade(raw: CardActivity) {
    const spl = raw.priceInfo?.splPrice;
    const priceUsd = spl?.rawAmount
      ? Number(spl.rawAmount) / 10 ** (spl.decimals ?? 6)
      : null;
    return {
      action: raw.action ?? null,
      mint: raw.card?.nftAddress ?? null,
      name: raw.card?.itemName ?? null,
      priceUsd:
        priceUsd !== null && Number.isFinite(priceUsd) ? priceUsd : null,
      from: raw.from?.wallet ?? null,
      to: raw.to?.wallet ?? null,
      signature: raw.transactionUrl?.match(/\/tx\/([^/?#]+)/)?.[1] ?? null,
      at: raw.createdAt ? new Date(raw.createdAt * 1000).toISOString() : null,
    };
  }

  // Marketplace mutations answer with a bare base64 string, a JSON string,
  // `{ transaction }`, or `{ transactions }` for multi-step escrow flows.
  public static parseTransactions(text: string): string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text.trim() ? [text.trim()] : [];
    }
    if (typeof parsed === "string") {
      return [parsed];
    }
    if (parsed && typeof parsed === "object") {
      const o = parsed as { transaction?: unknown; transactions?: unknown };
      if (Array.isArray(o.transactions)) {
        return o.transactions.filter((t): t is string => typeof t === "string");
      }
      if (typeof o.transaction === "string") {
        return [o.transaction];
      }
    }
    return [];
  }

  // Collector Crypt shipping lists come back bare or wrapped.
  public static coerceList<T>(data: unknown): T[] {
    if (Array.isArray(data)) {
      return data as T[];
    }
    if (data && typeof data === "object") {
      const o = data as Record<string, unknown>;
      for (const key of ["data", "shipments", "outboundShipments", "items"]) {
        if (Array.isArray(o[key])) {
          return o[key] as T[];
        }
      }
    }
    return [];
  }

  private static gradeLine(
    attrs: NftAttribute[] | null | undefined
  ): string | null {
    const company = attr(attrs, "Grading Company");
    const grade = attr(attrs, "The Grade");
    return [company, grade].filter(Boolean).join(" ") || null;
  }
}

function attr(
  attrs: NftAttribute[] | null | undefined,
  name: string
): string | undefined {
  return attrs?.find((a) => a.trait_type === name)?.value || undefined;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
