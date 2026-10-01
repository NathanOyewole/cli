import { GENERATED_WALLET, type ParityCase } from "../types.ts";

const TCG = "https://tcgapi.jup.ag/v1";
const MARKET = "https://jup.ag/api/gacha/marketplace";
const BUYER = "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9";
const COLLECTOR = "AR77XD4ZGVqgWR4eWapQUJmo57F3hJ4fm5RicnXsZzvn";
const LOOTBOX_EARNER = "98HtiZbtVEWpj1XHANHP1YzftDgXtLMKe7iUiHQ9cNwM";
const UNCLAIMED_HOLDER = "5AWhStitFRPPYR4GjPk2ieyg8VLhygcrXMmbUuoQ7Z5i";
const VERIFIED_PULL_MEMO = "cc-4392e287-6278-4ec1-9640-12ba1a8ecbd8";

type Card = {
  id: string;
  nftAddress: string;
  listing: { price: number; currency?: string; marketplace?: string } | null;
  owner?: { wallet?: string | null } | null;
  burnId?: string | null;
  lastTransferredAt?: string | null;
};

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

// Buyback offers only exist for recent pulls that weren't sold back yet, so
// find a live one at run time.
async function findBuyback(): Promise<{ wallet: string; mint: string }> {
  const { data } = await get<{ data: { wallet: string; nftId: string }[] }>(
    `${TCG}/winners?count=200`
  );
  const offers = await Promise.all(
    data.map(async (w) => {
      const offer = await get<{ available?: boolean }>(
        `${TCG}/buyback?wallet=${w.wallet}&nft=${w.nftId}`
      ).catch(() => ({ available: false }));
      return offer.available ? { wallet: w.wallet, mint: w.nftId } : null;
    })
  );
  // An offer can outlive the card leaving the puller's wallet, and the oldest
  // ones have outlived the puller's keep-or-sell decision.
  for (const offer of offers.filter((o) => o !== null).reverse()) {
    const { filterNFtCard } = await get<{ filterNFtCard: Card[] }>(
      `${MARKET}/browse?page=1&step=1&search=${offer.mint}`
    );
    if (filterNFtCard[0]?.owner?.wallet === offer.wallet) {
      return offer;
    }
  }
  throw new Error("no live buyback offer");
}

async function findCheapListing(): Promise<{ mint: string; seller: string }> {
  const res = await get<{ filterNFtCard: Card[] }>(
    `${MARKET}/browse?page=1&step=20&listPriceMin=1&listPriceMax=40&orderBy=listedPriceAsc`
  );
  const card = res.filterNFtCard.find(
    (c) =>
      c.listing?.marketplace === "CC" &&
      c.listing.currency === "USDC" &&
      c.owner?.wallet &&
      c.owner.wallet !== BUYER
  );
  if (!card) {
    throw new Error("no cheap USDC listing");
  }
  return { mint: card.nftAddress, seller: card.owner!.wallet! };
}

// Freshly pulled cards sit in a buyback window and can't be listed yet.
async function findListableCard(): Promise<string> {
  const res = await get<{ filterNFtCard: Card[] }>(
    `${MARKET}/owned?wallet=${COLLECTOR}&page=1&step=100&orderBy=dateDesc`
  );
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const card = res.filterNFtCard.find(
    (c) =>
      !c.listing &&
      !c.burnId &&
      c.lastTransferredAt &&
      Date.parse(c.lastTransferredAt) < weekAgo
  );
  if (!card) {
    throw new Error("no listable card");
  }
  return card.nftAddress;
}

const [buyback, listing, listable] = await Promise.all([
  findBuyback().catch(() => ({
    wallet: "HDefvmYegeX1Q8yV7jD7zXWZM6iRrrdr6yV4H6QZqUs7",
    mint: "Fr72igk9V2AHj5yZbUHYPyreUooYf4uD7WaeCTckzcZN",
  })),
  findCheapListing().catch(() => ({
    mint: "D5i9HJe3Rj12TEcUwG9X4MUMKahWxQ3TsLFcLsrFysoS",
    seller: "ERp9c1dq71fngTkWSdLkhLnjS1SmY6V1DA5zpk75AHhm",
  })),
  findListableCard().catch(
    () => "CaC3r5kd5wTUerQFhw9tTeZjc7zxdMkVoBdnz5eLt2Yo"
  ),
]);

const nonEmpty = (key: string) => (json: unknown) =>
  Array.isArray((json as Record<string, unknown>)[key]) &&
  ((json as Record<string, unknown[]>)[key]?.length ?? 0) > 0;

// Buyback first: offers vanish as soon as the puller sells back or keeps.
export const cases: ParityCase[] = [
  {
    id: "gacha-buyback",
    feature: "gacha-collection",
    kind: "tx",
    args: ["gacha", "buyback", "--mint", buyback.mint],
    wallet: buyback.wallet,
  },
  {
    id: "rewards-campaigns-ended",
    feature: "rewards-filter",
    kind: "read",
    args: ["rewards", "campaigns", "--status", "ended"],
    expect: (json) =>
      nonEmpty("campaigns")(json) &&
      (json as { campaigns: { status: string }[] }).campaigns.every(
        (c) => c.status === "ended"
      ),
  },
  {
    id: "rewards-campaigns-live",
    feature: "rewards-filter",
    kind: "read",
    args: ["rewards", "campaigns", "--status", "live"],
    expect: (json) =>
      (json as { campaigns: { status: string }[] }).campaigns.every(
        (c) => c.status !== "ended"
      ),
  },
  {
    id: "rewards-campaign-detail",
    feature: "rewards-detail",
    kind: "read",
    args: ["rewards", "campaigns", "--campaign", "tessera"],
    expect: (json) =>
      (json as { campaign: { slug: string } }).campaign.slug === "tessera",
  },
  {
    id: "rewards-leaderboard-earnings",
    feature: "rewards-progress",
    kind: "read",
    args: ["rewards", "leaderboard", "--campaign", "tessera", "--limit", "5"],
    expect: nonEmpty("entries"),
  },
  {
    id: "rewards-leaderboard-volume",
    feature: "rewards-progress",
    kind: "read",
    args: [
      "rewards",
      "leaderboard",
      "--campaign",
      "dominion-silver",
      "--period",
      "3",
    ],
    expect: nonEmpty("entries"),
  },
  {
    id: "rewards-leaderboard-teams",
    feature: "rewards-progress",
    kind: "read",
    args: ["rewards", "leaderboard", "--campaign", "european-final"],
    expect: nonEmpty("teams"),
  },
  {
    id: "rewards-progress",
    feature: "rewards-progress",
    kind: "read",
    args: [
      "rewards",
      "progress",
      "--campaign",
      "tessera",
      "--address",
      LOOTBOX_EARNER,
    ],
    expect: (json) => (json as { openedBoxes?: number }).openedBoxes! > 0,
  },
  {
    id: "rewards-unclaimed",
    feature: "rewards-progress",
    kind: "read",
    args: ["rewards", "unclaimed", "--address", UNCLAIMED_HOLDER],
    expect: nonEmpty("rewards"),
  },
  {
    id: "rewards-claim",
    feature: "rewards-progress",
    kind: "unsupported",
    reason:
      "`jup rewards claim` is built (GET claim -> sign -> POST postClaim), but no campaign is claimable right now: the only one in its claim window (asr-2026-q2) has its claim vault closed on-chain (simulation fails AccountNotInitialized), and jup.ag also shows it as ended",
  },
  {
    id: "rewards-apply",
    feature: "rewards-build",
    kind: "read",
    args: [
      "--dry-run",
      "rewards",
      "apply",
      "--project",
      "Parity Check",
      "--token",
      "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "--contact-method",
      "email",
      "--contact",
      "parity@example.com",
    ],
    expect: (json) =>
      (json as { submitted: boolean; dryRun: boolean }).submitted === false &&
      (json as { dryRun: boolean }).dryRun === true,
  },
  {
    id: "gacha-packs",
    feature: "gacha-packs",
    kind: "read",
    args: ["gacha", "packs"],
    expect: nonEmpty("packs"),
  },
  {
    id: "gacha-pack-detail",
    feature: "gacha-packs",
    kind: "read",
    args: ["gacha", "packs", "--pack", "pokemon_50", "--limit", "5"],
    expect: (json) =>
      (json as { pack: { cards: unknown[] } }).pack.cards.length > 0,
  },
  {
    id: "gacha-open",
    feature: "gacha-packs",
    kind: "tx",
    args: ["gacha", "open", "--pack", "pokemon_50", "--quantity", "2"],
    wallet: BUYER,
  },
  {
    id: "gacha-gift",
    feature: "gacha-packs",
    kind: "tx",
    args: [
      "gacha",
      "gift",
      "--pack",
      "pokemon_50",
      "--to",
      "BQ72nSv9f3PRyRKCBnHLVrerrv37CYTHm5h3s9VSGQDV",
    ],
    wallet: BUYER,
  },
  {
    id: "gacha-phygitals-packs",
    feature: "gacha-packs",
    kind: "unsupported",
    reason:
      "Phygitals and Beezie packs (and multi-platform buy/inventory/buyback) live only on api.jup.ag/gacha/v2, which answers 403 'Endpoint access not available for this organization' to any key but the web app's gacha-specific one; Collector Crypt packs work through tcgapi.jup.ag/v1",
  },
  {
    id: "gacha-marketplace",
    feature: "gacha-marketplace",
    kind: "read",
    args: [
      "gacha",
      "marketplace",
      "--search",
      "Pikachu",
      "--sort",
      "list-price-asc",
      "--limit",
      "5",
    ],
    expect: nonEmpty("listings"),
  },
  {
    id: "gacha-marketplace-filters",
    feature: "gacha-marketplace",
    kind: "read",
    args: [
      "gacha",
      "marketplace",
      "--category",
      "Pokemon",
      "--grading-company",
      "PSA",
      "--min-grade",
      "10",
      "--limit",
      "5",
    ],
    expect: nonEmpty("listings"),
  },
  {
    id: "gacha-card",
    feature: "gacha-marketplace",
    kind: "read",
    args: ["gacha", "card", "--mint", listing.mint],
    expect: (json) => (json as { mint: string }).mint === listing.mint,
  },
  {
    id: "gacha-buy",
    feature: "gacha-marketplace",
    kind: "tx",
    args: ["gacha", "buy", "--mint", listing.mint],
    wallet: BUYER,
  },
  {
    id: "gacha-delist",
    feature: "gacha-marketplace",
    kind: "tx",
    args: ["gacha", "delist", "--mint", listing.mint],
    wallet: listing.seller,
  },
  {
    id: "gacha-list",
    feature: "gacha-marketplace",
    kind: "tx",
    args: ["gacha", "list", "--mint", listable, "--price", "999"],
    wallet: COLLECTOR,
  },
  {
    id: "gacha-collection",
    feature: "gacha-collection",
    kind: "read",
    args: ["gacha", "collection", "--address", COLLECTOR],
    expect: nonEmpty("cards"),
  },
  {
    id: "gacha-activity",
    feature: "gacha-collection",
    kind: "read",
    args: ["gacha", "activity", "--address", COLLECTOR, "--limit", "5"],
    expect: nonEmpty("pulls"),
  },
  {
    id: "gacha-shipping",
    feature: "gacha-collection",
    kind: "read",
    args: ["gacha", "shipping"],
    wallet: GENERATED_WALLET,
    expect: (json) =>
      Array.isArray((json as { shipments: unknown }).shipments) &&
      Array.isArray((json as { addresses: unknown }).addresses),
  },
  {
    id: "gacha-ship",
    feature: "gacha-collection",
    kind: "unsupported",
    reason:
      "`jup gacha ship` exists but redeeming cards for delivery is a real-world shipment; its --dry-run stops at the Collector Crypt quote because preparing opens a shipment order, so there is no transaction to simulate",
  },
  {
    id: "gacha-verify",
    feature: "gacha-replay",
    kind: "read",
    args: ["gacha", "verify", "--memo", VERIFIED_PULL_MEMO],
    expect: (json) => (json as { valid: boolean }).valid === true,
  },
  {
    id: "gacha-winners",
    feature: "gacha-replay",
    kind: "read",
    args: ["gacha", "winners", "--limit", "5"],
    expect: nonEmpty("winners"),
  },
  {
    id: "gacha-replay-animation",
    feature: "gacha-replay",
    kind: "unsupported",
    reason:
      "the replay is a client-side animation of a pull; the CLI shows the pull's card via `gacha card --mint` and its proof via `gacha verify --memo`",
  },
  {
    id: "gacha-leaderboard",
    feature: "gacha-leaderboard",
    kind: "read",
    args: [
      "gacha",
      "leaderboard",
      "--limit",
      "5",
      "--address",
      "FjNcEsXLshVqJp27txAcHn8cuHyW1pEaD2eCpLLfdudR",
    ],
    expect: (json) =>
      nonEmpty("entries")(json) &&
      (json as { me: { entry: unknown } }).me.entry !== null,
  },
];
