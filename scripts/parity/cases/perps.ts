import {
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
} from "@solana/kit";

import {
  decodeUserBundle,
  userAccountAddress,
} from "../../../src/lib/DeltaNeutralVault.ts";
import { decodeActiveStake } from "../../../src/lib/JupStake.ts";
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
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(
      process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }
    );
    if (res.status === 429 && attempt < 5) {
      await Bun.sleep(2000 * (attempt + 1));
      continue;
    }
    return ((await res.json()) as { result: T }).result;
  }
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

// A loan wallet holding enough USDC to repay 1 USDC, so the repay-only quote
// that sizes `--withdraw max` succeeds.
const withRepayableLoan = async () => {
  const history = await get<{ dataList: { walletAddress: string }[] }>(
    "loans/history?start=0&end=50"
  );
  for (const wallet of new Set(history.dataList.map((h) => h.walletAddress))) {
    const res = await fetch(`${PERPS_API}/loans/repay-withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        walletAddress: wallet,
        repayTokenAmount: "1000000",
        withdrawTokenAmount: "0",
      }),
    });
    const quote = (await res.json()) as {
      maxWithdrawTokenAmountBeforeWithdraw?: string;
    };
    if (
      res.ok &&
      BigInt(quote.maxWithdrawTokenAmountBeforeWithdraw ?? 0) > 0n
    ) {
      return { WALLET: wallet };
    }
  }
  throw new Error("no recent loan wallet can repay 1 USDC");
};

const JTX_API = "https://gum-api.jup.net/fe/mainnet-beta/perps";
const JTX_GATEWAY = "gumhFpP3saWX8arwLx4peMZ6kBBXXbL7RWVuMtCjedY";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type JtxTrader = {
  wallet: string;
  positions: { symbol: string; size: string; markPrice: string }[];
  orders: { orderId: string }[];
  usdc: bigint;
  stakedJup: bigint;
};

async function jtxGet<T>(path: string): Promise<T> {
  const res = await fetch(`${JTX_API}/${path}`);
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function stakedJup(wallet: string): Promise<bigint> {
  const encoder = getAddressEncoder();
  const program = address("voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj");
  const [locker] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: [
      "Locker",
      encoder.encode(address("bJ1TRoFo2P6UHVwqdiipp6Qhp2HaaHpLowZ5LHet8Gm")),
    ],
  });
  const [escrow] = await getProgramDerivedAddress({
    programAddress: program,
    seeds: ["Escrow", encoder.encode(locker), encoder.encode(address(wallet))],
  });
  const info = await rpc<{ value: { data: [string, string] } | null }>(
    "getAccountInfo",
    [escrow, { encoding: "base64" }]
  );
  return info.value
    ? decodeActiveStake(Buffer.from(info.value.data[0], "base64"))
    : 0n;
}

let jtxTradersPromise: Promise<JtxTrader[]> | undefined;

// Wallets that recently sent JTX cross-chain intents (fee payers of txs on
// the gateway program), with their positions, orders, USDC, and staked JUP.
function jtxTraders(): Promise<JtxTrader[]> {
  jtxTradersPromise ??= (async () => {
    const sigs = await rpc<{ signature: string; err: unknown }[]>(
      "getSignaturesForAddress",
      [JTX_GATEWAY, { limit: 40 }]
    );
    const wallets = new Set<string>();
    for (const { signature, err } of sigs) {
      if (err || wallets.size >= 8) {
        continue;
      }
      const tx = await rpc<{
        transaction: { message: { accountKeys: string[] } };
      } | null>("getTransaction", [
        signature,
        { maxSupportedTransactionVersion: 0, encoding: "json" },
      ]);
      const payer = tx?.transaction.message.accountKeys[0];
      if (payer) {
        wallets.add(payer);
      }
    }
    const traders: JtxTrader[] = [];
    for (const wallet of wallets) {
      const [account] = await getProgramDerivedAddress({
        programAddress: address("jtxQHH3ysuWRETjaynai3jowPztq2LBJApVFcEv4Wmg"),
        seeds: [
          "cross_margin",
          getAddressEncoder().encode(address(wallet)),
          Uint8Array.of(255),
        ],
      });
      const [positions, orders] = await Promise.all([
        jtxGet<JtxTrader["positions"]>(`tradingAccount/${account}/positions`),
        jtxGet<JtxTrader["orders"]>(`tradingAccount/${account}/orders`),
      ]).catch(() => [[], []] as [JtxTrader["positions"], JtxTrader["orders"]]);
      traders.push({
        wallet,
        positions,
        orders,
        usdc: await balanceOf(wallet, USDC_MINT),
        stakedJup: await stakedJup(wallet),
      });
    }
    return traders;
  })();
  return jtxTradersPromise;
}

const withJtxTrader =
  (
    match: (t: JtxTrader) => boolean,
    vars: (t: JtxTrader) => Record<string, string> = () => ({})
  ) =>
  async () => {
    const trader = (await jtxTraders()).find(match);
    if (!trader) {
      throw new Error("no recent JTX wallet matches");
    }
    return { WALLET: trader.wallet, ...vars(trader) };
  };

// Opening needs USDC for collateral and the 69 JUP private-beta stake.
const canOpenJtx = (t: JtxTrader) =>
  t.usdc >= 15_000_000n && t.stakedJup >= 69_000_000n;

const NT_BUNDLE = address("BUNDeH5A4c47bcEoAjBhN3sCjLgYnRsmt9ibMztqVkC9");

let vaultUsersPromise:
  | Promise<{ wallet: string; shares: bigint }[]>
  | undefined;

// Depositors of the JLP Delta Neutral vault: every ntbundle user account
// (owner at offset 8) whose PDA matches this vault.
function vaultUsers() {
  vaultUsersPromise ??= (async () => {
    const accounts = await rpc<
      { pubkey: string; account: { data: [string, string] } }[]
    >("getProgramAccounts", [
      NT_BUNDLE,
      {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: getBase58Decoder().decode(
                Uint8Array.from([32, 181, 106, 26, 67, 130, 185, 241])
              ),
            },
          },
        ],
        dataSlice: { offset: 8, length: 32 },
      },
    ]);
    const users: { wallet: string; shares: bigint }[] = [];
    for (const { pubkey, account } of accounts) {
      const owner = getAddressDecoder().decode(
        Buffer.from(account.data[0], "base64")
      );
      if ((await userAccountAddress(owner)) !== pubkey || users.length >= 20) {
        continue;
      }
      const info = await rpc<{ value: { data: [string, string] } | null }>(
        "getAccountInfo",
        [pubkey, { encoding: "base64" }]
      );
      if (info.value) {
        users.push({
          wallet: owner,
          shares: decodeUserBundle(Buffer.from(info.value.data[0], "base64"))
            .shares,
        });
      }
    }
    return users;
  })();
  return vaultUsersPromise;
}

const withVaultShares = async () => {
  const user = (await vaultUsers()).find((u) => u.shares > 20_000_000n);
  if (!user) {
    throw new Error("no delta neutral depositor with over 20 shares");
  }
  return { WALLET: user.wallet };
};

const withVaultUsdc = async () => {
  for (const user of await vaultUsers()) {
    if ((await balanceOf(user.wallet, USDC_MINT)) >= 11_000_000n) {
      return { WALLET: user.wallet };
    }
  }
  throw new Error("no delta neutral depositor holds 11 USDC");
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
  {
    id: "loans-repay-withdraw-max",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "loans", "repay", "--amount", "1", "--withdraw", "max"],
    resolve: withRepayableLoan,
  },
  {
    id: "leaderboard",
    feature: "perps-rankings",
    kind: "read",
    args: ["perps", "leaderboard", "--asset", "SOL"],
    expect: hasItems("traders"),
  },
  {
    id: "leaderboard-past-week-pnl",
    feature: "perps-rankings",
    kind: "read",
    args: [
      "perps",
      "leaderboard",
      "--asset",
      "BTC",
      "--week",
      "30",
      "--sort",
      "pnl",
      "--limit",
      "5",
    ],
    expect: hasItems("traders"),
  },
  {
    id: "trader-stats",
    feature: "perps-rankings",
    kind: "read",
    args: ["perps", "stats", "--address", WALLET, "--asset", "SOL"],
    resolve: async () => {
      const board = await get<{ topTradersByVolume: { owner: string }[] }>(
        `top-traders?marketMint=${MINT_BY_ASSET.SOL}&year=${new Date().getUTCFullYear()}&week=current`
      );
      return { WALLET: board.topTradersByVolume[0]!.owner };
    },
    expect: (json) => ((json as { volumeUsd?: number }).volumeUsd ?? 0) > 0,
  },
  {
    id: "jtx-markets",
    feature: "perps-direction",
    kind: "read",
    args: ["perps", "jtx", "markets"],
    expect: (json) =>
      Array.isArray(json) &&
      json.some((m) => m.asset === "JUP") &&
      json.every((m) => typeof m.fundingRatePctPerHour === "number"),
  },
  {
    id: "jtx-orderbook",
    feature: "perps-order",
    kind: "read",
    args: ["perps", "jtx", "orderbook", "--asset", "JUP", "--depth", "5"],
    expect: hasItems("bids"),
  },
  {
    id: "jtx-positions",
    feature: "perps-positions",
    kind: "read",
    args: ["perps", "jtx", "positions", "--address", WALLET],
    resolve: withJtxTrader((t) => t.positions.length > 0),
    expect: hasItems("positions"),
  },
  {
    id: "jtx-order-history",
    feature: "perps-positions",
    kind: "read",
    args: ["perps", "jtx", "history", "--address", WALLET, "--limit", "5"],
    resolve: withJtxTrader((t) => t.positions.length > 0),
    expect: hasItems("orders"),
  },
  {
    id: "jtx-trades",
    feature: "perps-positions",
    kind: "read",
    args: ["perps", "jtx", "history", "--address", WALLET, "--type", "trades"],
    resolve: withJtxTrader((t) => t.positions.length > 0),
    expect: hasItems("trades"),
  },
  {
    id: "jtx-funding-history",
    feature: "perps-positions",
    kind: "read",
    args: ["perps", "jtx", "history", "--address", WALLET, "--type", "funding"],
    resolve: withJtxTrader((t) => t.positions.length > 0),
    expect: (json) => Array.isArray((json as { funding?: unknown }).funding),
  },
  {
    id: "jtx-open-market",
    feature: "perps-direction",
    kind: "tx",
    args: [
      "perps",
      "jtx",
      "open",
      "--asset",
      "JUP",
      "--side",
      "long",
      "--amount",
      "10",
      "--leverage",
      "3",
    ],
    resolve: withJtxTrader(canOpenJtx),
  },
  {
    id: "jtx-open-limit",
    feature: "perps-order",
    kind: "tx",
    args: [
      "perps",
      "jtx",
      "open",
      "--asset",
      "HYPE",
      "--side",
      "short",
      "--amount",
      "10",
      "--size",
      "20",
      "--limit",
      "$LIMIT",
    ],
    resolve: async () => {
      const markets =
        await jtxGet<{ symbol: string; markPrice: number }[]>("markets");
      const hype = markets.find((m) => m.symbol === "HYPE")!;
      return {
        ...(await withJtxTrader(canOpenJtx)()),
        LIMIT: (hype.markPrice * 1.05).toFixed(2),
      };
    },
  },
  {
    id: "jtx-close-partial",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "jtx", "close", "--asset", "$ASSET", "--size", "$SIZE"],
    resolve: withJtxTrader(
      (t) => t.positions.some((p) => Number(p.size) * Number(p.markPrice) > 20),
      (t) => {
        const p = t.positions.find(
          (p) => Number(p.size) * Number(p.markPrice) > 20
        )!;
        return { ASSET: p.symbol, SIZE: "10" };
      }
    ),
  },
  {
    id: "jtx-close-full",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "jtx", "close", "--asset", "$ASSET"],
    resolve: withJtxTrader(
      (t) => t.positions.length > 0,
      (t) => ({ ASSET: t.positions[0]!.symbol })
    ),
  },
  {
    id: "jtx-cancel-order",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "jtx", "close", "--order", "$ORDER"],
    resolve: withJtxTrader(
      (t) => t.orders.length > 0,
      (t) => ({ ORDER: t.orders[0]!.orderId })
    ),
  },
  {
    id: "jtx-add-collateral",
    feature: "perps-positions",
    kind: "tx",
    args: ["perps", "jtx", "set", "--asset", "$ASSET", "--add-collateral", "5"],
    resolve: withJtxTrader(
      (t) => t.positions.length > 0 && t.usdc >= 10_000_000n,
      (t) => ({ ASSET: t.positions[0]!.symbol })
    ),
  },
  {
    id: "jtx-remove-collateral",
    feature: "perps-positions",
    kind: "tx",
    args: [
      "perps",
      "jtx",
      "set",
      "--asset",
      "$ASSET",
      "--remove-collateral",
      "1",
    ],
    resolve: async () => {
      for (const t of await jtxTraders()) {
        const { accounts } = (await (
          await fetch(`${JTX_API}/tradingAccount`, {
            headers: { "X-PUBKEY": t.wallet },
          })
        ).json()) as {
          accounts: { market: string | null; data: { freeBalance: string } }[];
        };
        const funded = accounts.find(
          (a) => a.market && Number(a.data.freeBalance) > 5
        );
        if (funded) {
          return { WALLET: t.wallet, ASSET: funded.market! };
        }
      }
      throw new Error("no recent JTX wallet has free collateral");
    },
  },
  {
    id: "delta-neutral-info",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "delta-neutral", "info"],
    expect: (json) =>
      typeof (json as { tvlUsd?: unknown }).tvlUsd === "number" &&
      typeof (json as { apyPct?: unknown }).apyPct === "number",
  },
  {
    id: "delta-neutral-history",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "delta-neutral", "history", "--days", "7"],
    expect: hasItems("snapshots"),
  },
  {
    id: "delta-neutral-positions",
    feature: "perps-jlp",
    kind: "read",
    args: ["perps", "delta-neutral", "positions", "--address", WALLET],
    resolve: withVaultShares,
    expect: (json) =>
      ((json as { position?: { balanceUsd?: number } }).position?.balanceUsd ??
        0) > 0,
  },
  {
    id: "delta-neutral-deposit",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "delta-neutral", "deposit", "--amount", "11"],
    resolve: withVaultUsdc,
  },
  {
    // A wallet with no vault account gets initializeBundleDepositor first.
    id: "delta-neutral-first-deposit",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "delta-neutral", "deposit", "--amount", "11"],
    resolve: async () => {
      const users = new Set((await vaultUsers()).map((u) => u.wallet));
      for (const t of await jtxTraders()) {
        if (!users.has(t.wallet) && t.usdc >= 11_000_000n) {
          return { WALLET: t.wallet };
        }
      }
      throw new Error("no USDC holder without a vault account");
    },
  },
  {
    id: "delta-neutral-withdraw",
    feature: "perps-jlp",
    kind: "tx",
    args: ["perps", "delta-neutral", "withdraw", "--amount", "10"],
    resolve: withVaultShares,
  },
];
