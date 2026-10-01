import type {
  DcaOrderParams,
  PriceOrderParams,
} from "../clients/TriggerClient.ts";

export const LIMIT_INTENTS = [
  "take-profit",
  "stop-loss",
  "buy-dip",
  "buy-pump",
  "trailing-stop",
  "oco",
  "otoco",
] as const;

export type LimitIntent = (typeof LIMIT_INTENTS)[number];

export const MIN_ORDER_USD = 10;
// The web app validates DCA orders against 9.8 to tolerate price drift.
const MIN_DCA_ORDER_VALIDATION_USD = 9.8;
export const DEFAULT_EXPIRY = "7d";
export const DRY_RUN_CANCEL_NOTE =
  "No transaction built: the cancel transaction only exists once the cancel starts, which stops the order from filling.";

const MAX_EXPIRY_SECONDS = 10 * 365 * 86_400;
const MIN_INTERVAL_SECONDS = 60;
const MAX_INTERVAL_SECONDS = 31_536_000;
const MIN_DCA_ORDERS = 2;
const MAX_DCA_ORDERS = 100;
const MIN_TRAILING_PCT = 0.5;
const MAX_TRAILING_PCT = 90;
// Web app defaults: stop-loss style legs (SL, trailing, buy-the-pump) use 20%;
// take-profit and buy-the-dip leave slippage to the server.
const PROTECTIVE_SLIPPAGE_BPS = 2000;

// Jupiter Lend jl-token mints used by "Earn while you wait".
const EARN_JL_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:
    "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:
    "Cmn4v2wipYV41dkakDvCgFJpxhtaaKt11NyWV8pjSE8A",
  JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD:
    "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk",
};

const DURATION_UNITS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
  mo: 2_592_000,
};

export function parseDuration(value: string, optionName: string): number {
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d|w|mo)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid ${optionName}: "${value}". Use a number with a unit (e.g. 30m, 1h, 1d, 1w, 1mo) or seconds.`
    );
  }
  const unit = (match[2] ?? "s").toLowerCase();
  const seconds = Math.round(Number(match[1]) * DURATION_UNITS[unit]!);
  if (seconds <= 0) {
    throw new Error(`${optionName} must be greater than zero.`);
  }
  return seconds;
}

export function parseExpiry(value: string, now: number): number {
  const seconds = parseDuration(value, "--expiry");
  if (seconds > MAX_EXPIRY_SECONDS) {
    throw new Error("--expiry cannot be longer than 10 years.");
  }
  return now + seconds * 1000;
}

export function parseInterval(value: string): number {
  const seconds = parseDuration(value, "--interval");
  if (seconds < MIN_INTERVAL_SECONDS || seconds > MAX_INTERVAL_SECONDS) {
    throw new Error("--interval must be between 1 minute and 1 year.");
  }
  return seconds;
}

export function parseIntent(value: string): LimitIntent {
  const intent = value.toLowerCase() as LimitIntent;
  if (!LIMIT_INTENTS.includes(intent)) {
    throw new Error(
      `Invalid --intent. Must be one of: ${LIMIT_INTENTS.join(", ")}.`
    );
  }
  return intent;
}

// Buy intents watch the token being bought; sell intents watch the token being sold.
export function getTriggerSide(intent: LimitIntent): "input" | "output" {
  return intent === "buy-dip" || intent === "buy-pump" || intent === "otoco"
    ? "output"
    : "input";
}

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
]);
const BASE_MINTS = new Set([...STABLE_MINTS, SOL_MINT]);

// jup.ag's trade side for a pair: paying with USDC, USDT or SOL is a buy and
// receiving one of them is a sell (SOL into a stablecoin is a sell); any other
// pair counts as a buy.
export function getTradeSide(
  inputMint: string,
  outputMint: string
): "buy" | "sell" {
  const inputBase = BASE_MINTS.has(inputMint);
  const outputBase = BASE_MINTS.has(outputMint);
  if (inputBase && outputBase) {
    return inputMint === SOL_MINT ? "sell" : "buy";
  }
  return !inputBase && outputBase ? "sell" : "buy";
}

function supportsIntent(
  intent: "oco" | "otoco",
  inputMint: string,
  outputMint: string
): boolean {
  const side = getTradeSide(inputMint, outputMint);
  return intent === "oco"
    ? side === "sell"
    : side === "buy" && BASE_MINTS.has(inputMint);
}

// Mirrors jup.ag's pair orientation rules: OCO sells a token for USDC, USDT or
// SOL, OTOCO buys one with them, and a stablecoin is never the trigger token.
export function assertIntentPair(
  intent: LimitIntent,
  inputMint: string,
  outputMint: string
): void {
  const triggerSide = getTriggerSide(intent);
  const triggerMint = triggerSide === "input" ? inputMint : outputMint;
  if (STABLE_MINTS.has(triggerMint)) {
    const alternative =
      triggerSide === "input"
        ? "To buy with it, use --intent buy-dip, buy-pump or otoco"
        : "To sell into it, use --intent take-profit, stop-loss, trailing-stop or oco";
    throw new Error(
      `--intent ${intent} watches the price of --${triggerSide === "input" ? "from" : "to"}, which is a stablecoin and cannot be a trigger token. ${alternative}, or swap --from and --to.`
    );
  }
  if (intent !== "oco" && intent !== "otoco") {
    return;
  }
  if (supportsIntent(intent, inputMint, outputMint)) {
    return;
  }
  const shape =
    intent === "oco"
      ? "sells a token for USDC, USDT or SOL (e.g. --from JUP --to USDC)"
      : "buys a token with USDC, USDT or SOL (e.g. --from USDC --to JUP)";
  const hint = supportsIntent(intent, outputMint, inputMint)
    ? " Swap --from and --to."
    : "";
  throw new Error(`--intent ${intent} only ${shape}.${hint}`);
}

// Accepts a USD value (or market cap when `mcap` is set), or a signed percent
// such as "+10%" / "-5%" relative to `referencePriceUsd`.
export function resolveTargetPrice(
  value: string,
  opts: {
    optionName: string;
    referencePriceUsd: number | undefined;
    circSupply: number | undefined;
    mcap: boolean;
  }
): number {
  const trimmed = value.trim();
  let price: number;
  if (trimmed.endsWith("%")) {
    const pct = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(pct)) {
      throw new Error(`Invalid ${opts.optionName}: "${value}".`);
    }
    if (!opts.referencePriceUsd) {
      throw new Error(
        `Cannot resolve ${opts.optionName} as a percentage: no reference price available.`
      );
    }
    price = opts.referencePriceUsd * (1 + pct / 100);
  } else if (opts.mcap) {
    if (!opts.circSupply) {
      throw new Error(
        `Cannot use --mcap: circulating supply is unknown for this token.`
      );
    }
    price = Number(trimmed) / opts.circSupply;
  } else {
    price = Number(trimmed);
  }
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`${opts.optionName} must resolve to a positive price.`);
  }
  return price;
}

export function buildPriceOrderParams(opts: {
  intent: LimitIntent;
  triggerMint: string;
  marketPriceUsd: number | undefined;
  priceUsd?: number | undefined;
  tpPriceUsd?: number | undefined;
  slPriceUsd?: number | undefined;
  trailingPct?: number | undefined;
  slippageBps?: number | undefined;
}): PriceOrderParams {
  const { intent, triggerMint, priceUsd, tpPriceUsd, slPriceUsd } = opts;
  const slippage = (fallback: number | undefined) =>
    opts.slippageBps ?? fallback;
  const reject = (flags: [string, unknown][]) => {
    const extra = flags.filter(([, v]) => v !== undefined).map(([f]) => f);
    if (extra.length > 0) {
      throw new Error(
        `${extra.join(", ")} cannot be used with --intent ${intent}.`
      );
    }
  };

  switch (intent) {
    case "take-profit":
    case "stop-loss":
    case "buy-dip":
    case "buy-pump": {
      reject([
        ["--tp", tpPriceUsd],
        ["--sl", slPriceUsd],
        ["--trailing", opts.trailingPct],
      ]);
      if (priceUsd === undefined) {
        throw new Error(`--price is required for --intent ${intent}.`);
      }
      const above = intent === "take-profit" || intent === "buy-pump";
      const protective = intent === "stop-loss" || intent === "buy-pump";
      return {
        orderType: "single",
        triggerMint,
        triggerCondition: above ? "above" : "below",
        triggerPriceUsd: priceUsd,
        slippageBps: slippage(protective ? PROTECTIVE_SLIPPAGE_BPS : undefined),
      };
    }
    case "trailing-stop": {
      reject([
        ["--price", priceUsd],
        ["--tp", tpPriceUsd],
        ["--sl", slPriceUsd],
      ]);
      const pct = opts.trailingPct;
      if (pct === undefined) {
        throw new Error("--trailing is required for --intent trailing-stop.");
      }
      if (
        !(pct >= MIN_TRAILING_PCT && pct <= MAX_TRAILING_PCT) ||
        !Number.isInteger(pct / MIN_TRAILING_PCT)
      ) {
        throw new Error(
          "--trailing must be between 0.5 and 90, in steps of 0.5."
        );
      }
      return {
        orderType: "single",
        triggerMint,
        triggerCondition: "below",
        trailingBps: Math.round(pct * 100),
        slippageBps: slippage(PROTECTIVE_SLIPPAGE_BPS),
      };
    }
    case "oco": {
      reject([
        ["--price", priceUsd],
        ["--trailing", opts.trailingPct],
      ]);
      if (tpPriceUsd === undefined || slPriceUsd === undefined) {
        throw new Error("--tp and --sl are both required for --intent oco.");
      }
      if (tpPriceUsd <= slPriceUsd) {
        throw new Error("--tp must be above --sl.");
      }
      return {
        orderType: "oco",
        triggerMint,
        tpPriceUsd,
        slPriceUsd,
        tpSlippageBps: slippage(undefined),
        slSlippageBps: slippage(PROTECTIVE_SLIPPAGE_BPS),
      };
    }
    case "otoco": {
      reject([["--trailing", opts.trailingPct]]);
      if (priceUsd === undefined) {
        throw new Error("--price (entry) is required for --intent otoco.");
      }
      if (tpPriceUsd === undefined && slPriceUsd === undefined) {
        throw new Error("--intent otoco requires --tp and/or --sl.");
      }
      if (tpPriceUsd !== undefined && tpPriceUsd <= priceUsd) {
        throw new Error("--tp must be above the entry --price.");
      }
      if (slPriceUsd !== undefined && slPriceUsd >= priceUsd) {
        throw new Error("--sl must be below the entry --price.");
      }
      if (!opts.marketPriceUsd) {
        throw new Error("Cannot place otoco order: market price unavailable.");
      }
      const above = priceUsd >= opts.marketPriceUsd;
      return {
        orderType: "otoco",
        triggerMint,
        triggerCondition: above ? "above" : "below",
        triggerPriceUsd: priceUsd,
        slippageBps: slippage(above ? PROTECTIVE_SLIPPAGE_BPS : undefined),
        ...(tpPriceUsd !== undefined && {
          tpPriceUsd,
          tpSlippageBps: slippage(undefined),
        }),
        ...(slPriceUsd !== undefined && {
          slPriceUsd,
          slSlippageBps: slippage(PROTECTIVE_SLIPPAGE_BPS),
        }),
      };
    }
  }
}

export function buildDcaOrderParams(opts: {
  inputMint: string;
  outputMint: string;
  orderCount: number;
  intervalSeconds: number;
  minPriceUsd?: number | undefined;
  maxPriceUsd?: number | undefined;
  earn: boolean;
}): DcaOrderParams & { jlMint?: string } {
  const { orderCount, minPriceUsd, maxPriceUsd } = opts;
  if (
    !Number.isInteger(orderCount) ||
    orderCount < MIN_DCA_ORDERS ||
    orderCount > MAX_DCA_ORDERS
  ) {
    throw new Error(
      `--orders must be an integer between ${MIN_DCA_ORDERS} and ${MAX_DCA_ORDERS}.`
    );
  }
  for (const [flag, value] of [
    ["--min-price", minPriceUsd],
    ["--max-price", maxPriceUsd],
  ] as const) {
    if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
      throw new Error(`${flag} must be a positive number.`);
    }
  }
  if (
    minPriceUsd !== undefined &&
    maxPriceUsd !== undefined &&
    minPriceUsd >= maxPriceUsd
  ) {
    throw new Error("--min-price must be below --max-price.");
  }
  const priceConditional =
    minPriceUsd !== undefined || maxPriceUsd !== undefined;
  const base = {
    orderCount,
    intervalSeconds: opts.intervalSeconds,
  };
  if (priceConditional) {
    if (opts.earn) {
      throw new Error(
        "--earn is only available for time-based orders (without --min-price/--max-price)."
      );
    }
    return {
      ...base,
      orderType: "price_conditional",
      triggerMint: opts.outputMint,
      ...(minPriceUsd !== undefined && { minPriceUsd }),
      ...(maxPriceUsd !== undefined && { maxPriceUsd }),
    };
  }
  if (opts.earn) {
    const jlMint = EARN_JL_MINTS[opts.inputMint];
    if (!jlMint) {
      throw new Error(
        "--earn is only available when paying with USDC, USDT or JupUSD."
      );
    }
    return { ...base, orderType: "time_based", jlEnabled: true, jlMint };
  }
  return { ...base, orderType: "time_based" };
}

export function assertMinOrderUsd(valueUsd: number | undefined): void {
  if (valueUsd !== undefined && valueUsd < MIN_ORDER_USD) {
    throw new Error(`Min order size: $${MIN_ORDER_USD}.`);
  }
}

export function assertMinDcaOrderUsd(
  totalUsd: number | undefined,
  orderCount: number
): void {
  if (
    totalUsd !== undefined &&
    totalUsd / orderCount < MIN_DCA_ORDER_VALIDATION_USD
  ) {
    throw new Error(
      `Min $${MIN_ORDER_USD} per order: increase --amount to at least $${orderCount * MIN_ORDER_USD} for ${orderCount} orders.`
    );
  }
}
