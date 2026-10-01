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
  sizeUsd: string;
  collateralToken: string;
  collateralMint: string;
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
      }>(
        `top-traders?marketMint=${mint}&year=${new Date().getUTCFullYear()}&week=current`
      );
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

type CollateralLimits = Record<string, string>;
const DECIMALS: Record<string, number> = { SOL: 9, BTC: 8, ETH: 8, USDC: 6 };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(
    process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }
  );
  return ((await res.json()) as { result: T }).result;
}

async function balanceOf(wallet: string, mint: string): Promise<bigint> {
  if (mint === MINT_BY_ASSET.SOL) {
    return BigInt((await rpc<{ value: number }>("getBalance", [wallet])).value);
  }
  const { value } = await rpc<{
    value: {
      account: {
        data: { parsed: { info: { tokenAmount: { amount: string } } } };
      };
    }[];
  }>("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
  return value.reduce(
    (sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount),
    0n
  );
}

// A position plus a collateral amount inside the server's limits that the
// owner's wallet can actually fund.
const withCollateral = (kind: "deposit" | "withdraw") => async () => {
  for (const trader of await traders()) {
    for (const p of trader.positions) {
      const decimals = DECIMALS[p.collateralToken];
      if (decimals === undefined) {
        continue;
      }
      const limits = await get<CollateralLimits>(
        `positions/collateral-limits?inputMint=${p.collateralMint}&positionPubkey=${p.positionPubkey}`
      );
      if (kind === "withdraw") {
        const min = Number(limits.minCollateralWithdrawalUsd) / 1e6;
        const max = Number(limits.maxCollateralWithdrawalUsd) / 1e6;
        if (min * 1.2 <= max) {
          return {
            WALLET: trader.wallet,
            POSITION: p.positionPubkey,
            AMOUNT: fmt(min * 1.2),
          };
        }
        continue;
      }
      const min = BigInt(limits.minCollateralDepositTokenAmount!);
      const amount = (min * 12n) / 10n;
      if ((await balanceOf(trader.wallet, p.collateralMint)) > amount * 2n) {
        return {
          WALLET: trader.wallet,
          POSITION: p.positionPubkey,
          AMOUNT: (Number(amount) / 10 ** decimals).toFixed(decimals),
        };
      }
    }
  }
  throw new Error(`no leaderboard position allows a collateral ${kind}`);
};

const withPartialTp = async () => {
  const { trader, position } = await findPosition();
  const price = await priceOf(MINT_BY_ASSET[position.asset]!);
  return {
    WALLET: trader.wallet,
    POSITION: position.positionPubkey,
    TP: fmt(position.side === "long" ? price * 1.5 : price * 0.5),
    SIZE: fmt(Number(position.sizeUsd) / 1e6 / 10),
  };
};

const JLP_MINT = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";

// A JLP holder (from the public holders list) with SOL for fees.
const withJlpHolder = async () => {
  const res = await fetch(`https://datapi.jup.ag/v1/holders/${JLP_MINT}`);
  const { holders } = (await res.json()) as {
    holders: { address: string; amount: number; solBalanceDisplay: number }[];
  };
  // Some large holders are program-owned vaults the API can't build for.
  for (const h of holders) {
    if (h.amount < 1000 || h.solBalanceDisplay < 0.05) {
      continue;
    }
    const res = await fetch(`${PERPS_API}/jlp/burn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: h.address,
        burnTokenAmount: "10000000",
        receiveToken: "USDC",
      }),
    });
    if (res.ok) {
      return { WALLET: h.address };
    }
  }
  throw new Error("no JLP holder the API can build a burn for");
};

type LoanPosition = {
  maxBorrowTokenAmount: string;
  maxWithdrawTokenAmount: string;
};

// A wallet with a live JLP loan, found through recent public loan activity.
const withLoan = (match: (p: LoanPosition) => boolean) => async () => {
  const history = await get<{ dataList: { walletAddress: string }[] }>(
    "loans/history?start=0&end=50"
  );
  const wallets = new Set(history.dataList.map((h) => h.walletAddress));
  for (const wallet of wallets) {
    const { dataList } = await get<{ dataList: LoanPosition[] }>(
      `loans/positions?walletAddress=${wallet}`
    );
    if (dataList[0] && match(dataList[0])) {
      return { WALLET: wallet };
    }
  }
  throw new Error("no recent loan wallet matches");
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
  {
    id: "pool-info",
    feature: "perps-direction",
    kind: "read",
    args: ["perps", "markets"],
    expect: (json) =>
      Array.isArray(json) &&
      json.every(
        (m) => typeof m.openFeePct === "number" && m.longBorrowRatePctPerHour
      ),
  },
  {
    id: "add-collateral",
    feature: "perps-positions",
    kind: "tx",
    args: [
      "perps",
      "set",
      "--position",
      "$POSITION",
      "--add-collateral",
      "$AMOUNT",
    ],
    resolve: withCollateral("deposit"),
  },
  {
    id: "remove-collateral",
    feature: "perps-positions",
    kind: "tx",
    args: [
      "perps",
      "set",
      "--position",
      "$POSITION",
      "--remove-collateral",
      "$AMOUNT",
    ],
    resolve: withCollateral("withdraw"),
  },
  {
    id: "partial-tp",
    feature: "perps-order",
    kind: "tx",
    args: [
      "perps",
      "set",
      "--position",
      "$POSITION",
      "--tp",
      "$TP",
      "--size",
      "$SIZE",
    ],
    resolve: withPartialTp,
  },
  {
    id: "edit-limit-order-size",
    feature: "perps-order",
    kind: "unsupported",
    reason:
      "web disables it (size field commented out in PerpsEditOpenOrderForm.tsx) and PATCH /orders/limit ignores sizeUsdDelta on v1 and v2; only the trigger price can change",
  },
  {
    // No leaderboard wallet had an expired order (467 scanned), so this checks
    // the request path; the server builds one tx per expired order when present.
    id: "close-expired-orders",
    feature: "perps-positions",
    kind: "read",
    args: ["--dry-run", "perps", "close", "--order", "expired"],
    resolve: withPosition(),
    expect: (json) =>
      Array.isArray((json as { transactions?: unknown }).transactions),
  },
  {
    id: "history-export",
    feature: "perps-positions",
    kind: "read",
    args: [
      "perps",
      "history",
      "--address",
      WALLET,
      "--export",
      "/tmp/jup-parity-perps-trades.csv",
    ],
    resolve: withPosition(),
    expect: (json) => ((json as { trades?: number }).trades ?? 0) > 0,
  },
  {
    id: "jlp-info",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "jlp", "info"],
    expect: (json) =>
      typeof (json as { apyPct?: unknown }).apyPct === "number" &&
      hasItems("custodies")(json),
  },
  {
    id: "jlp-mint",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "jlp", "mint", "--amount", "0.5", "--input", "SOL"],
  },
  {
    id: "jlp-burn",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "jlp", "burn", "--amount", "10", "--receive", "BTC"],
    resolve: withJlpHolder,
  },
  {
    id: "loans-info",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "loans", "info"],
    expect: (json) =>
      typeof (json as { borrowAprPct?: unknown }).borrowAprPct === "number",
  },
  {
    id: "loans-positions",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "loans", "positions", "--address", WALLET],
    resolve: withLoan(() => true),
    expect: hasItems("positions"),
  },
  {
    id: "loans-history",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "loans", "history", "--address", WALLET, "--limit", "5"],
    resolve: withLoan(() => true),
    expect: hasItems("history"),
  },
  {
    id: "loans-open",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "loans", "borrow", "--deposit", "10", "--amount", "5"],
    resolve: withJlpHolder,
  },
  {
    id: "loans-borrow-more",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "loans", "borrow", "--amount", "1"],
    resolve: withLoan((p) => BigInt(p.maxBorrowTokenAmount) > 2_000_000n),
  },
  {
    id: "loans-withdraw",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "loans", "repay", "--withdraw", "0.1"],
    resolve: withLoan((p) => BigInt(p.maxWithdrawTokenAmount) > 200_000n),
  },
];
