import { WALLET, type ParityCase } from "../types.ts";

const PERPS_API = "https://perps-api.jup.ag/v2";
const MINT_BY_ASSET: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
  BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
};
const MINTS = Object.values(MINT_BY_ASSET);

type LivePosition = {
  positionPubkey: string;
  asset: string;
  side: string;
  collateralToken: string;
  tpslRequests: {
    positionRequestPubkey: string;
    requestType: string;
    entirePosition: boolean;
  }[];
};
type LiveOrder = {
  positionRequestPubkey: string;
  marketMint: string;
  side: string;
};
type Trader = {
  wallet: string;
  positions: LivePosition[];
  orders: LiveOrder[];
};

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${PERPS_API}/${path}`);
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function priceOf(mint: string): Promise<number> {
  const stats = await get<{ price: string }>(`market-stats?mint=${mint}`);
  return Number(stats.price);
}

const fmt = (n: number) => n.toFixed(2);

let tradersPromise: Promise<Trader[]> | undefined;

// Public leaderboard traders with their current positions and limit orders,
// so cases act on positions that exist right now.
function traders(): Promise<Trader[]> {
  tradersPromise ??= (async () => {
    const owners = new Set<string>();
    for (const mint of MINTS) {
      const board = await get<{
        topTradersByVolume: { owner: string }[];
        topTradersByPnl: { owner: string }[];
      }>(`top-traders?marketMint=${mint}&year=2026&week=current`);
      [...board.topTradersByPnl, ...board.topTradersByVolume]
        .slice(0, 15)
        .forEach((t) => owners.add(t.owner));
    }
    const result: Trader[] = [];
    for (const wallet of owners) {
      const [positions, orders] = await Promise.all([
        get<{ dataList: LivePosition[] }>(`positions?walletAddress=${wallet}`),
        get<{ dataList: LiveOrder[] }>(`orders/limit?walletAddress=${wallet}`),
      ]);
      result.push({
        wallet,
        positions: positions.dataList,
        orders: orders.dataList,
      });
    }
    return result;
  })();
  return tradersPromise;
}

async function findPosition(
  match: (p: LivePosition) => boolean = () => true
): Promise<{ trader: Trader; position: LivePosition }> {
  for (const trader of await traders()) {
    const position = trader.positions.find(match);
    if (position) {
      return { trader, position };
    }
  }
  throw new Error("no leaderboard wallet has a matching open position");
}

const withPosition = (match?: (p: LivePosition) => boolean) => async () => {
  const { trader, position } = await findPosition(match);
  return { WALLET: trader.wallet, POSITION: position.positionPubkey };
};

const withTpsl = async () => {
  const { trader, position } = await findPosition((p) =>
    p.tpslRequests.some((t) => t.entirePosition)
  );
  const tpsl = position.tpslRequests.find((t) => t.entirePosition)!;
  return {
    WALLET: trader.wallet,
    POSITION: position.positionPubkey,
    TPSL: tpsl.positionRequestPubkey,
  };
};

// A trigger price the API accepts: within 2x of mark, on the far side for
// the order direction so it never fills.
const withLimitOrder = async () => {
  const trader = (await traders()).find((t) => t.orders.length > 0);
  if (!trader) {
    throw new Error("no leaderboard wallet has a pending limit order");
  }
  const order = trader.orders[0]!;
  const price = await priceOf(order.marketMint);
  return {
    WALLET: trader.wallet,
    ORDER: order.positionRequestPubkey,
    TRIGGER: fmt(order.side === "long" ? price * 0.6 : price * 1.6),
  };
};

const withPrices = (mint: string) => async () => {
  const price = await priceOf(mint);
  return { TP: fmt(price * 1.5), SL: fmt(price * 0.9) };
};

const hasFullTp = (p: LivePosition) =>
  p.tpslRequests.some((t) => t.requestType === "tp" && t.entirePosition);

const tpFor = (hasTp: boolean) => async () => {
  const { trader, position } = await findPosition(
    (p) => hasFullTp(p) === hasTp
  );
  const price = await priceOf(MINT_BY_ASSET[position.asset]!);
  return {
    WALLET: trader.wallet,
    POSITION: position.positionPubkey,
    TP: fmt(position.side === "long" ? price * 1.5 : price * 0.5),
  };
};

const hasItems = (key: string) => (json: unknown) =>
  Array.isArray((json as Record<string, unknown>)[key]) &&
  ((json as Record<string, unknown[]>)[key]?.length ?? 0) > 0;

export const cases: ParityCase[] = [
  {
    id: "markets",
    feature: "perps-direction",
    kind: "read",
    args: ["perps", "markets"],
    expect: (json) => Array.isArray(json) && json.length === 3,
  },
  {
    id: "open-long-market",
    feature: "perps-direction",
    kind: "tx",
    args: [
      "perps",
      "open",
      "--asset",
      "SOL",
      "--side",
      "long",
      "--amount",
      "0.2",
      "--leverage",
      "2",
    ],
  },
  {
    id: "open-short-usdc",
    feature: "perps-direction",
    kind: "tx",
    args: [
      "perps",
      "open",
      "--asset",
      "ETH",
      "--side",
      "sell",
      "--amount",
      "20",
      "--input",
      "USDC",
      "--size",
      "40",
    ],
  },
  {
    id: "open-limit",
    feature: "perps-order",
    kind: "tx",
    args: [
      "perps",
      "open",
      "--asset",
      "BTC",
      "--side",
      "long",
      "--amount",
      "20",
      "--input",
      "USDC",
      "--leverage",
      "3",
      "--limit",
      "$TRIGGER",
    ],
    resolve: async () => ({
      TRIGGER: fmt((await priceOf(MINT_BY_ASSET.BTC!)) * 0.6),
    }),
  },
  {
    id: "open-with-tpsl",
    feature: "perps-order",
    kind: "tx",
    args: [
      "perps",
      "open",
      "--asset",
      "SOL",
      "--side",
      "long",
      "--amount",
      "0.2",
      "--leverage",
      "5",
      "--tp",
      "$TP",
      "--sl",
      "$SL",
    ],
    resolve: withPrices(MINT_BY_ASSET.SOL!),
  },
  {
    id: "positions",
    feature: "perps-positions",
    kind: "read",
    args: ["perps", "positions", "--address", WALLET],
    resolve: withPosition(),
    expect: hasItems("positions"),
  },
  {
    id: "history",
    feature: "perps-positions",
    kind: "read",
    args: ["perps", "history", "--address", WALLET, "--limit", "5"],
    resolve: withPosition(),
    expect: hasItems("trades"),
  },
  {
    id: "set-tpsl",
    feature: "perps-order",
    kind: "tx",
    args: ["perps", "set", "--position", "$POSITION", "--tp", "$TP"],
    resolve: tpFor(false),
  },
  {
    id: "update-tpsl",
    feature: "perps-order",
    kind: "tx",
    args: ["perps", "set", "--position", "$POSITION", "--tp", "$TP"],
    resolve: tpFor(true),
  },
  {
    id: "update-limit-order",
    feature: "perps-order",
    kind: "tx",
    args: ["perps", "set", "--order", "$ORDER", "--limit", "$TRIGGER"],
    resolve: withLimitOrder,
  },
  {
    id: "close-partial",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "close", "--position", "$POSITION", "--size", "50"],
    resolve: withPosition(),
  },
  {
    id: "close-full",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "close", "--position", "$POSITION", "--receive", "USDC"],
    resolve: withPosition(),
  },
  {
    id: "close-all",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "close", "--position", "all"],
    resolve: withPosition(),
  },
  {
    id: "cancel-limit-order",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "close", "--order", "$ORDER"],
    resolve: withLimitOrder,
  },
  {
    id: "cancel-tpsl",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "close", "--tpsl", "$TPSL"],
    resolve: withTpsl,
  },
];
