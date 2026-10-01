// Port of the @jup-ag/lend smart-vault DEX math (dex `userOperations` and the
// `dexMath` helpers it uses). Every amount is a native bigint; reserves and
// shares are the 9-decimal values the program and the Fluid API carry.

export const PRICE_PRECISION = 10n ** 15n;
export const SIX_DECIMALS = 1_000_000n;
export const SLIPPAGE_SCALE = SIX_DECIMALS;
const TWO_DECIMALS = 100n;
const FOUR_DECIMALS = 10_000n;
const NINE_DECIMALS = 10n ** 9n;
const MAX_U64 = 2n ** 64n - 1n;
const SWAP_ROUTING_SQRT_SCALE = 10n ** 18n;
const SHARE_RATIO_PRECISION = 10n ** 15n;
const MINIMUM_LIQUIDITY_USER_OPERATIONS = 1_000_000n;

export type UserOpConfig = {
  token0Decimals: number;
  token1Decimals: number;
  fee: bigint;
};

export type PricesAndExchangePrices = {
  centerPrice: bigint;
  upperRange: bigint;
  lowerRange: bigint;
  geometricMean: bigint;
};

export type CollateralReserves = {
  token0RealReserves: bigint;
  token1RealReserves: bigint;
  token0ImaginaryReserves: bigint;
  token1ImaginaryReserves: bigint;
};

export type DebtReserves = CollateralReserves & {
  token0Debt: bigint;
  token1Debt: bigint;
};

export type SharesEstimate = { shares: bigint; sharesWithSlippage: bigint };

export type PerfectMaxEstimate = {
  token0Amt: bigint;
  token1Amt: bigint;
  token0AmtWithSlippage: bigint;
  token1AmtWithSlippage: bigint;
};

export type OneTokenMaxEstimate = {
  tokenAmount: bigint;
  tokenAmountWithSlippage: bigint;
};

export class DexMathError extends Error {
  public readonly code: string;

  constructor(code: string) {
    super(`DEX math: ${code.toLowerCase().replaceAll("_", " ")}`);
    this.name = "DexMathError";
    this.code = code;
  }
}

export class DexMath {
  public static deposit(
    cfg: UserOpConfig,
    pex: PricesAndExchangePrices,
    col: CollateralReserves,
    token0Amt: bigint,
    token1Amt: bigint,
    totalSupplyShares: bigint,
    slippage: bigint
  ): SharesEstimate {
    assertSlippage(slippage);
    const shares = rawDeposit(
      cfg,
      pex,
      col,
      token0Amt,
      token1Amt,
      totalSupplyShares
    );
    return { shares, sharesWithSlippage: minWithSlippage(shares, slippage) };
  }

  public static withdraw(
    cfg: UserOpConfig,
    pex: PricesAndExchangePrices,
    col: CollateralReserves,
    token0Amt: bigint,
    token1Amt: bigint,
    totalSupplyShares: bigint,
    slippage: bigint
  ): SharesEstimate {
    assertSlippage(slippage);
    const shares = rawWithdraw(
      cfg,
      pex,
      col,
      token0Amt,
      token1Amt,
      totalSupplyShares
    );
    return { shares, sharesWithSlippage: maxWithSlippage(shares, slippage) };
  }

  public static borrow(
    cfg: UserOpConfig,
    pex: PricesAndExchangePrices,
    debt: DebtReserves,
    token0Amt: bigint,
    token1Amt: bigint,
    totalBorrowShares: bigint,
    slippage: bigint
  ): SharesEstimate {
    assertSlippage(slippage);
    const shares = rawBorrow(
      cfg,
      pex,
      debt,
      token0Amt,
      token1Amt,
      totalBorrowShares
    );
    return { shares, sharesWithSlippage: maxWithSlippage(shares, slippage) };
  }

  public static payback(
    cfg: UserOpConfig,
    pex: PricesAndExchangePrices,
    debt: DebtReserves,
    token0Amt: bigint,
    token1Amt: bigint,
    totalBorrowShares: bigint,
    slippage: bigint
  ): SharesEstimate {
    assertSlippage(slippage);
    const shares = rawPayback(
      cfg,
      pex,
      debt,
      token0Amt,
      token1Amt,
      totalBorrowShares
    );
    return { shares, sharesWithSlippage: minWithSlippage(shares, slippage) };
  }

  public static withdrawMax(
    cfg: UserOpConfig,
    pex: PricesAndExchangePrices,
    col: CollateralReserves,
    shares: bigint,
    totalSupplyShares: bigint,
    inToken0: boolean,
    slippage: bigint
  ): OneTokenMaxEstimate {
    assertSlippage(slippage);
    if (totalSupplyShares === 0n || shares === 0n) {
      throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
    }
    verifyRedeem(shares, totalSupplyShares);
    if (col.token0RealReserves === 0n || col.token1RealReserves === 0n) {
      throw new DexMathError("INVALID_COLLATERAL_RESERVES");
    }
    const c2 = updatedColReserves(shares, totalSupplyShares, col, false);
    const token0Raw = col.token0RealReserves - c2.token0RealReserves - 1n;
    const token1Raw = col.token1RealReserves - c2.token1RealReserves - 1n;
    if (token0Raw < 0n || token1Raw < 0n) {
      throw new DexMathError("PROPORTIONAL_RAW_UNDERFLOW");
    }
    const fee = SIX_DECIMALS - cfg.fee;
    let tokenAmount: bigint;
    if (inToken0) {
      const swapped = getAmountOut(
        token1Raw,
        c2.token1ImaginaryReserves,
        c2.token0ImaginaryReserves
      );
      assertToken0Reserves(
        col.token0RealReserves - (token0Raw + swapped),
        col.token1RealReserves,
        pex.centerPrice
      );
      const net = token0Raw + mulDiv(swapped, fee, SIX_DECIMALS);
      tokenAmount = descale(net - 1n, cfg.token0Decimals) - 1n;
    } else {
      const swapped = getAmountOut(
        token0Raw,
        c2.token0ImaginaryReserves,
        c2.token1ImaginaryReserves
      );
      assertToken1Reserves(
        col.token0RealReserves,
        col.token1RealReserves - (token1Raw + swapped),
        pex.centerPrice
      );
      const net = token1Raw + mulDiv(swapped, fee, SIX_DECIMALS);
      tokenAmount = descale(net - 1n, cfg.token1Decimals) - 1n;
    }
    if (tokenAmount <= 0n) {
      throw new DexMathError("PERFECT_AMOUNTS_ROUND_TO_ZERO");
    }
    return {
      tokenAmount,
      tokenAmountWithSlippage: minWithSlippage(tokenAmount, slippage),
    };
  }

  public static paybackMax(
    cfg: UserOpConfig,
    pex: PricesAndExchangePrices,
    debt: DebtReserves,
    shares: bigint,
    totalBorrowShares: bigint,
    inToken0: boolean,
    slippage: bigint
  ): OneTokenMaxEstimate {
    assertSlippage(slippage);
    if (totalBorrowShares === 0n || shares === 0n) {
      throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
    }
    verifyRedeem(shares, totalBorrowShares);
    if (debt.token0Debt === 0n || debt.token1Debt === 0n) {
      throw new DexMathError("INVALID_DEBT_RESERVES");
    }
    const d2 = updatedDebtReserves(shares, totalBorrowShares, debt);
    const fee = SIX_DECIMALS + cfg.fee;
    let tokenAmount: bigint;
    if (inToken0) {
      const token0Raw = swapAndPaybackOneTokenPerfectShares(
        d2.token0ImaginaryReserves,
        d2.token1ImaginaryReserves,
        debt.token0Debt,
        debt.token1Debt,
        d2.token0RealReserves,
        d2.token1RealReserves
      );
      if (
        token0Raw > mulDiv(debt.token0Debt, SIX_DECIMALS - 1n, SIX_DECIMALS)
      ) {
        throw new DexMathError("SWAP_AND_PAYBACK_OUT_OF_RANGE");
      }
      assertToken0Reserves(
        debt.token0Debt - token0Raw,
        debt.token1Debt,
        pex.centerPrice
      );
      const direct = debt.token0Debt - d2.token0Debt;
      const swap = token0Raw - direct;
      if (swap < 0n) {
        throw new DexMathError("SWAP_PORTION_UNDERFLOW");
      }
      const withFee = direct + mulDiv(swap, fee, SIX_DECIMALS);
      tokenAmount = descale(withFee + 1n, cfg.token0Decimals) + 1n;
    } else {
      const token1Raw = swapAndPaybackOneTokenPerfectShares(
        d2.token1ImaginaryReserves,
        d2.token0ImaginaryReserves,
        debt.token1Debt,
        debt.token0Debt,
        d2.token1RealReserves,
        d2.token0RealReserves
      );
      if (
        token1Raw > mulDiv(debt.token1Debt, SIX_DECIMALS - 1n, SIX_DECIMALS)
      ) {
        throw new DexMathError("SWAP_AND_PAYBACK_OUT_OF_RANGE");
      }
      assertToken1Reserves(
        debt.token0Debt,
        debt.token1Debt - token1Raw,
        pex.centerPrice
      );
      const direct = debt.token1Debt - d2.token1Debt;
      const swap = token1Raw - direct;
      if (swap < 0n) {
        throw new DexMathError("SWAP_PORTION_UNDERFLOW");
      }
      const withFee = direct + mulDiv(swap, fee, SIX_DECIMALS);
      tokenAmount = descale(withFee + 1n, cfg.token1Decimals) + 1n;
    }
    return {
      tokenAmount,
      tokenAmountWithSlippage: maxWithSlippage(tokenAmount, slippage),
    };
  }

  public static withdrawPerfectMax(
    cfg: UserOpConfig,
    col: CollateralReserves,
    shares: bigint,
    totalSupplyShares: bigint,
    slippage: bigint
  ): PerfectMaxEstimate {
    assertSlippage(slippage);
    if (totalSupplyShares === 0n || shares === 0n) {
      throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
    }
    verifyRedeem(shares, totalSupplyShares);
    const { token0Amt, token1Amt } = perfectAmountsFromShares(
      shares,
      col.token0RealReserves,
      col.token1RealReserves,
      totalSupplyShares,
      cfg,
      false
    );
    return {
      token0Amt,
      token1Amt,
      token0AmtWithSlippage: minWithSlippage(token0Amt, slippage),
      token1AmtWithSlippage: minWithSlippage(token1Amt, slippage),
    };
  }

  public static paybackPerfectMax(
    cfg: UserOpConfig,
    debt: DebtReserves,
    shares: bigint,
    totalBorrowShares: bigint,
    slippage: bigint
  ): PerfectMaxEstimate {
    assertSlippage(slippage);
    if (totalBorrowShares === 0n || shares === 0n) {
      throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
    }
    verifyRedeem(shares, totalBorrowShares);
    const { token0Amt, token1Amt } = perfectAmountsFromShares(
      shares,
      debt.token0Debt,
      debt.token1Debt,
      totalBorrowShares,
      cfg,
      true
    );
    return {
      token0Amt,
      token1Amt,
      token0AmtWithSlippage: maxWithSlippage(token0Amt, slippage),
      token1AmtWithSlippage: maxWithSlippage(token1Amt, slippage),
    };
  }
}

function mulDiv(a: bigint, b: bigint, den: bigint): bigint {
  if (den === 0n) {
    throw new DexMathError("DIVISION_BY_ZERO");
  }
  return (a * b) / den;
}

function mulDivUp(a: bigint, b: bigint, den: bigint): bigint {
  if (den === 0n) {
    throw new DexMathError("DIVISION_BY_ZERO");
  }
  const n = a * b;
  return n === 0n ? 0n : (n - 1n) / den + 1n;
}

function isqrt(n: bigint): bigint {
  if (n < 0n) {
    throw new DexMathError("ISQRT_OF_NEGATIVE");
  }
  if (n < 2n) {
    return n;
  }
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  while (true) {
    const y = (x + n / x) >> 1n;
    if (y >= x) {
      return x;
    }
    x = y;
  }
}

const abs = (x: bigint) => (x < 0n ? -x : x);

function scale(x: bigint, decimals: number): bigint {
  if (decimals > 9) {
    throw new DexMathError("SCALE_DECIMALS_TOO_HIGH");
  }
  return x * 10n ** BigInt(9 - decimals);
}

function descale(x: bigint, decimals: number): bigint {
  if (decimals > 9) {
    throw new DexMathError("DESCALE_DECIMALS_TOO_HIGH");
  }
  return x / 10n ** BigInt(9 - decimals);
}

function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
  return mulDiv(amountIn, reserveOut, reserveIn + amountIn);
}

function calculateReservesOutsideRange(
  gp: bigint,
  pa: bigint,
  rx: bigint,
  ry: bigint
): [bigint, bigint] {
  const p1 = pa - gp;
  if (p1 <= 0n) {
    throw new DexMathError("RESERVES_OUTSIDE_RANGE_INVALID");
  }
  const p2 = (gp * rx + ry * PRICE_PRECISION) / (2n * p1);
  const p3 = (rx * ry * PRICE_PRECISION) / p1;
  const xa = p2 + isqrt(p3 + p2 * p2);
  return [xa, mulDiv(xa, gp, PRICE_PRECISION)];
}

function calculateDebtReserves(
  gp: bigint,
  pb: bigint,
  dx: bigint,
  dy: bigint
): [bigint, bigint, bigint, bigint] {
  const dxGp = dx * gp;
  const dyPrec = dy * PRICE_PRECISION;
  const twoPrec = 2n * PRICE_PRECISION;
  const p1 =
    dxGp >= dyPrec ? (dxGp - dyPrec) / twoPrec : -((dyPrec - dxGp) / twoPrec);
  const p2 = (dx * dy * pb) / PRICE_PRECISION;
  const ry = p1 + isqrt(abs(p1) * abs(p1) + p2);
  if (ry < 0n) {
    throw new DexMathError("DEBT_RESERVES_NEGATIVE");
  }
  const ryPrec = ry * PRICE_PRECISION;
  const dxPb = dx * pb;
  if (ryPrec <= dxPb) {
    throw new DexMathError("DEBT_RESERVES_DENOM_INVALID");
  }
  const iryDenom = ryPrec - dxPb;
  if (iryDenom < 1_000_000n) {
    throw new DexMathError("DEBT_RESERVES_DENOM_TOO_SMALL");
  }
  const iry = (ry * ry * PRICE_PRECISION) / iryDenom;
  const irx = mulDiv(iry, dx, ry) - dx;
  const rx = mulDiv(irx, dy, iry + dy);
  return [rx, ry, irx, iry];
}

function checkPctBounds(value: bigint, g: bigint): void {
  const pct = mulDiv(value, 1_000_000n, g);
  if (pct < 1n || pct > 999_999n) {
    throw new DexMathError("AMOUNT_PERCENT_OUT_OF_BOUNDS");
  }
}

function getSwapAndDeposit(
  c: bigint,
  d: bigint,
  e: bigint,
  f: bigint,
  i: bigint
) {
  const positive = c * d + d * f + e * i;
  const ci = c * i;
  if (positive < ci) {
    throw new DexMathError("SWAP_AND_DEPOSIT_NEGATIVE_B");
  }
  const bOverI = (positive - ci) / i;
  const sqrtVal = isqrt(4n * c * e + bOverI * bOverI);
  if (sqrtVal <= bOverI) {
    throw new DexMathError("SWAP_AND_DEPOSIT_NEGATIVE_ROOT");
  }
  const amtToSwap = (sqrtVal - bOverI) / 2n;
  checkPctBounds(amtToSwap, c);
  const amtOut = mulDiv(amtToSwap, d, e + amtToSwap);
  const sharesA = mulDiv(c - amtToSwap, SHARE_RATIO_PRECISION, f + amtToSwap);
  const sharesB = mulDiv(amtOut, SHARE_RATIO_PRECISION, i - amtOut);
  return sharesA < sharesB ? sharesA : sharesB;
}

function getWithdrawAndSwap(
  c: bigint,
  d: bigint,
  e: bigint,
  f: bigint,
  g: bigint
) {
  const bHalfA = (d * e + 2n * c * d + c * f) / (2n * d);
  const cOverA = (c * f * g + c * d * g) / d;
  const bSq = bHalfA * bHalfA;
  if (bSq < cOverA) {
    throw new DexMathError("WITHDRAW_AND_SWAP_NO_SOLUTION");
  }
  const sqrtDisc = isqrt(bSq - cOverA);
  if (bHalfA < sqrtDisc) {
    throw new DexMathError("WITHDRAW_AND_SWAP_NEGATIVE_ROOT");
  }
  const tokenAxa = bHalfA - sqrtDisc;
  checkPctBounds(tokenAxa, g);
  return mulDiv(tokenAxa, SHARE_RATIO_PRECISION, c);
}

function getBorrowAndSwap(
  c: bigint,
  d: bigint,
  e: bigint,
  f: bigint,
  g: bigint
) {
  const bHalfA = (c * f + d * e + d * g) / (2n * d);
  const cOverA = (c * f * g) / d;
  const bSq = bHalfA * bHalfA;
  if (bSq < cOverA) {
    throw new DexMathError("BORROW_AND_SWAP_NO_SOLUTION");
  }
  const sqrtDisc = isqrt(bSq - cOverA);
  if (bHalfA < sqrtDisc) {
    throw new DexMathError("BORROW_AND_SWAP_NEGATIVE_ROOT");
  }
  const tokenAxa = bHalfA - sqrtDisc;
  checkPctBounds(tokenAxa, g);
  return mulDivUp(tokenAxa, SHARE_RATIO_PRECISION, c);
}

function getSwapAndPayback(
  c: bigint,
  d: bigint,
  e: bigint,
  f: bigint,
  g: bigint
) {
  const positive = c * f + d * e;
  const negative = f * g + d * g;
  if (positive < negative) {
    throw new DexMathError("SWAP_AND_PAYBACK_NEGATIVE_B");
  }
  const bOverA = (positive - negative) / d;
  const sqrtVal = isqrt(4n * e * g + bOverA * bOverA);
  if (sqrtVal < bOverA) {
    throw new DexMathError("SWAP_AND_PAYBACK_NEGATIVE_ROOT");
  }
  const amtToSwap = (sqrtVal - bOverA) / 2n;
  checkPctBounds(amtToSwap, g);
  const amt1Payback = mulDiv(f, amtToSwap, e + amtToSwap);
  const sharesA = mulDiv(g - amtToSwap, SHARE_RATIO_PRECISION, c - amtToSwap);
  const sharesB = mulDiv(amt1Payback, SHARE_RATIO_PRECISION, d + amt1Payback);
  return sharesA < sharesB ? sharesA : sharesB;
}

function swapAndPaybackOneTokenPerfectShares(
  a: bigint,
  b: bigint,
  c: bigint,
  d: bigint,
  i: bigint,
  j: bigint
): bigint {
  const l = a - i;
  const m = b - j;
  const z = mulDiv(a, b, l);
  const y = mulDiv(a, b, m);
  const v = z - m - d;
  const tokenAmt = c - mulDiv(v, y, m + v);
  if (tokenAmt > mulDiv(c, 999_999n, 1_000_000n)) {
    throw new DexMathError("PAYBACK_ONE_TOKEN_EXCEEDS_LIMIT");
  }
  return tokenAmt;
}

function assertSlippage(slippage: bigint): void {
  if (slippage < 0n || slippage > SLIPPAGE_SCALE) {
    throw new DexMathError("SLIPPAGE_OUT_OF_BOUNDS");
  }
}

function minWithSlippage(x: bigint, slippage: bigint): bigint {
  return mulDiv(x, SLIPPAGE_SCALE - slippage, SLIPPAGE_SCALE);
}

function maxWithSlippage(x: bigint, slippage: bigint): bigint {
  return mulDivUp(x, SLIPPAGE_SCALE + slippage, SLIPPAGE_SCALE);
}

function assertSwapAmountBounds(amtAdjusted: bigint, amount: bigint): void {
  if (amtAdjusted < SIX_DECIMALS || amount < TWO_DECIMALS || amount > MAX_U64) {
    throw new DexMathError("AMOUNT_LIMITS_EXCEEDED");
  }
}

function assertToken0Reserves(t0: bigint, t1: bigint, centerPrice: bigint) {
  if (
    t0 <
    mulDiv(t1, PRICE_PRECISION, centerPrice * MINIMUM_LIQUIDITY_USER_OPERATIONS)
  ) {
    throw new DexMathError("TOKEN0_RESERVES_TOO_LOW");
  }
}

function assertToken1Reserves(t0: bigint, t1: bigint, centerPrice: bigint) {
  if (
    t1 <
    mulDiv(t0, centerPrice, PRICE_PRECISION * MINIMUM_LIQUIDITY_USER_OPERATIONS)
  ) {
    throw new DexMathError("TOKEN1_RESERVES_TOO_LOW");
  }
}

function verifyMint(amount: bigint, totalAmount: bigint): void {
  if (
    amount < totalAmount / NINE_DECIMALS ||
    amount > totalAmount * NINE_DECIMALS
  ) {
    throw new DexMathError("MINT_OVERFLOW");
  }
}

function verifyRedeem(amount: bigint, totalAmount: bigint): void {
  if (
    amount > mulDiv(totalAmount, 9999n, FOUR_DECIMALS) ||
    amount < totalAmount / NINE_DECIMALS
  ) {
    throw new DexMathError("BURN_OVERFLOW");
  }
}

function updatedColReserves(
  newShares: bigint,
  totalShares: bigint,
  c: CollateralReserves,
  isMint: boolean
): CollateralReserves {
  const scaledTotal = isMint
    ? totalShares + newShares
    : totalShares - newShares;
  const f = (v: bigint) => mulDiv(v, scaledTotal, totalShares);
  return {
    token0RealReserves: f(c.token0RealReserves),
    token1RealReserves: f(c.token1RealReserves),
    token0ImaginaryReserves: f(c.token0ImaginaryReserves),
    token1ImaginaryReserves: f(c.token1ImaginaryReserves),
  };
}

function updatedDebtReserves(
  shares: bigint,
  totalShares: bigint,
  d: DebtReserves
): DebtReserves {
  const f = (v: bigint) => v - mulDiv(v, shares, totalShares);
  return {
    token0Debt: f(d.token0Debt),
    token1Debt: f(d.token1Debt),
    token0RealReserves: f(d.token0RealReserves),
    token1RealReserves: f(d.token1RealReserves),
    token0ImaginaryReserves: f(d.token0ImaginaryReserves),
    token1ImaginaryReserves: f(d.token1ImaginaryReserves),
  };
}

// Splits a two-token amount into the proportional part (shares at the pool
// ratio) and the excess of the larger leg, which settles through a swap.
function proportionalSplit(
  t0Adj: bigint,
  t1Adj: bigint,
  reserve0: bigint,
  reserve1: bigint,
  total: bigint,
  roundUp: boolean,
  error: string
) {
  const sharesFromT0 = mulDiv(t0Adj, SHARE_RATIO_PRECISION, reserve0);
  const sharesFromT1 = mulDiv(t1Adj, SHARE_RATIO_PRECISION, reserve1);
  const toShares = roundUp ? mulDivUp : mulDiv;
  if (sharesFromT0 > sharesFromT1) {
    return {
      shares: toShares(sharesFromT1, total, SHARE_RATIO_PRECISION),
      excessT0: mulDiv(
        sharesFromT0 - sharesFromT1,
        reserve0,
        SHARE_RATIO_PRECISION
      ),
      excessT1: 0n,
    };
  }
  if (sharesFromT1 > sharesFromT0) {
    return {
      shares: toShares(sharesFromT0, total, SHARE_RATIO_PRECISION),
      excessT0: 0n,
      excessT1: mulDiv(
        sharesFromT1 - sharesFromT0,
        reserve1,
        SHARE_RATIO_PRECISION
      ),
    };
  }
  throw new DexMathError(error);
}

function computeDepositShares(
  t0Adj: bigint,
  t1Adj: bigint,
  c: CollateralReserves,
  totalSupplyShares: bigint,
  fee: bigint
): bigint {
  if (c.token0RealReserves === 0n || c.token1RealReserves === 0n) {
    throw new DexMathError("INVALID_COLLATERAL_RESERVES");
  }
  if (t0Adj > 0n && t1Adj > 0n) {
    const split = proportionalSplit(
      t0Adj,
      t1Adj,
      c.token0RealReserves,
      c.token1RealReserves,
      totalSupplyShares,
      false,
      "INVALID_DEPOSIT_AMOUNTS"
    );
    const c2 = updatedColReserves(split.shares, totalSupplyShares, c, true);
    const total = totalSupplyShares + split.shares;
    let swapShares: bigint;
    if (split.excessT0 > 0n) {
      swapShares = getSwapAndDeposit(
        split.excessT0,
        c2.token1ImaginaryReserves,
        c2.token0ImaginaryReserves,
        c2.token0RealReserves,
        c2.token1RealReserves
      );
    } else if (split.excessT1 > 0n) {
      swapShares = getSwapAndDeposit(
        split.excessT1,
        c2.token0ImaginaryReserves,
        c2.token1ImaginaryReserves,
        c2.token1RealReserves,
        c2.token0RealReserves
      );
    } else {
      throw new DexMathError("DEPOSIT_AMOUNTS_ZERO");
    }
    const extra = mulDiv(
      mulDiv(swapShares, total, SHARE_RATIO_PRECISION),
      fee,
      SIX_DECIMALS
    );
    return split.shares + extra;
  }
  let swapShares: bigint;
  if (t0Adj > 0n) {
    swapShares = getSwapAndDeposit(
      t0Adj,
      c.token1ImaginaryReserves,
      c.token0ImaginaryReserves,
      c.token0RealReserves,
      c.token1RealReserves
    );
  } else if (t1Adj > 0n) {
    swapShares = getSwapAndDeposit(
      t1Adj,
      c.token0ImaginaryReserves,
      c.token1ImaginaryReserves,
      c.token1RealReserves,
      c.token0RealReserves
    );
  } else {
    throw new DexMathError("DEPOSIT_AMOUNTS_ZERO");
  }
  return mulDiv(
    mulDiv(swapShares, totalSupplyShares, SHARE_RATIO_PRECISION),
    fee,
    SIX_DECIMALS
  );
}

function computeWithdrawShares(
  t0Adj: bigint,
  t1Adj: bigint,
  token0Reserves: bigint,
  token1Reserves: bigint,
  totalSupplyShares: bigint,
  pex: PricesAndExchangePrices,
  fee: bigint
): bigint {
  if (token0Reserves === 0n || token1Reserves === 0n) {
    throw new DexMathError("INVALID_COLLATERAL_RESERVES");
  }
  let shares = 0n;
  let excessT0 = 0n;
  let excessT1 = 0n;
  let t0Res = token0Reserves;
  let t1Res = token1Reserves;
  let total = totalSupplyShares;
  if (t0Adj > 0n && t1Adj > 0n) {
    ({ shares, excessT0, excessT1 } = proportionalSplit(
      t0Adj,
      t1Adj,
      t0Res,
      t1Res,
      total,
      true,
      "INVALID_WITHDRAW_AMOUNTS"
    ));
    t0Res = t0Res - mulDiv(t0Res, shares, total);
    t1Res = t1Res - mulDiv(t1Res, shares, total);
    total = total - shares;
  } else if (t0Adj > 0n) {
    excessT0 = t0Adj;
  } else if (t1Adj > 0n) {
    excessT1 = t1Adj;
  } else {
    throw new DexMathError("WITHDRAW_AMOUNTS_ZERO");
  }
  const finalT0 = t0Res - excessT0;
  const finalT1 = t1Res - excessT1;
  let t0Outside: bigint;
  let t1Outside: bigint;
  if (pex.geometricMean < PRICE_PRECISION) {
    [t0Outside, t1Outside] = calculateReservesOutsideRange(
      pex.geometricMean,
      pex.upperRange,
      finalT0,
      finalT1
    );
  } else {
    const [yb, xa] = calculateReservesOutsideRange(
      mulDiv(PRICE_PRECISION, PRICE_PRECISION, pex.geometricMean),
      mulDiv(PRICE_PRECISION, PRICE_PRECISION, pex.lowerRange),
      finalT1,
      finalT0
    );
    t0Outside = xa;
    t1Outside = yb;
  }
  let swapShares: bigint;
  if (excessT0 > 0n) {
    swapShares = getWithdrawAndSwap(
      t0Res,
      t1Res,
      t0Outside,
      t1Outside,
      excessT0
    );
  } else if (excessT1 > 0n) {
    swapShares = getWithdrawAndSwap(
      t1Res,
      t0Res,
      t1Outside,
      t0Outside,
      excessT1
    );
  } else {
    throw new DexMathError("WITHDRAW_AMOUNTS_ZERO");
  }
  const extra = mulDivUp(
    mulDivUp(swapShares, total, SHARE_RATIO_PRECISION),
    fee,
    SIX_DECIMALS
  );
  return shares + extra;
}

function computeBorrowShares(
  t0Adj: bigint,
  t1Adj: bigint,
  token0Debt: bigint,
  token1Debt: bigint,
  totalBorrowShares: bigint,
  pex: PricesAndExchangePrices,
  fee: bigint
): bigint {
  if (token0Debt === 0n || token1Debt === 0n) {
    throw new DexMathError("INVALID_DEBT_RESERVES");
  }
  let shares = 0n;
  let excessT0 = 0n;
  let excessT1 = 0n;
  let t0d = token0Debt;
  let t1d = token1Debt;
  let total = totalBorrowShares;
  if (t0Adj > 0n && t1Adj > 0n) {
    ({ shares, excessT0, excessT1 } = proportionalSplit(
      t0Adj,
      t1Adj,
      t0d,
      t1d,
      total,
      true,
      "INVALID_BORROW_AMOUNTS"
    ));
    t0d = t0d + mulDiv(t0d, shares, total);
    t1d = t1d + mulDiv(t1d, shares, total);
    total = total + shares;
  } else if (t0Adj > 0n) {
    excessT0 = t0Adj;
  } else if (t1Adj > 0n) {
    excessT1 = t1Adj;
  } else {
    throw new DexMathError("BORROW_AMOUNTS_ZERO");
  }
  const finalT0Debt = t0d + excessT0;
  const finalT1Debt = t1d + excessT1;
  let t0Imag: bigint;
  let t1Imag: bigint;
  if (pex.geometricMean < PRICE_PRECISION) {
    const [, , irx, iry] = calculateDebtReserves(
      pex.geometricMean,
      pex.lowerRange,
      finalT0Debt,
      finalT1Debt
    );
    t0Imag = irx;
    t1Imag = iry;
  } else {
    const [, , iry, irx] = calculateDebtReserves(
      mulDiv(PRICE_PRECISION, PRICE_PRECISION, pex.geometricMean),
      mulDiv(PRICE_PRECISION, PRICE_PRECISION, pex.upperRange),
      finalT1Debt,
      finalT0Debt
    );
    t0Imag = irx;
    t1Imag = iry;
  }
  let swapShares: bigint;
  if (excessT0 > 0n) {
    swapShares = getBorrowAndSwap(t0d, t1d, t0Imag, t1Imag, excessT0);
  } else if (excessT1 > 0n) {
    swapShares = getBorrowAndSwap(t1d, t0d, t1Imag, t0Imag, excessT1);
  } else {
    throw new DexMathError("BORROW_AMOUNTS_ZERO");
  }
  const extra = mulDivUp(
    mulDivUp(swapShares, total, SHARE_RATIO_PRECISION),
    fee,
    SIX_DECIMALS
  );
  return shares + extra;
}

function computePaybackShares(
  t0Adj: bigint,
  t1Adj: bigint,
  d: DebtReserves,
  totalBorrowShares: bigint,
  fee: bigint
): bigint {
  if (d.token0Debt === 0n || d.token1Debt === 0n) {
    throw new DexMathError("INVALID_DEBT_RESERVES");
  }
  let shares = 0n;
  let excessT0 = 0n;
  let excessT1 = 0n;
  let d2 = d;
  let adjTotal = totalBorrowShares;
  if (t0Adj > 0n && t1Adj > 0n) {
    const sharesFromT0 = mulDiv(t0Adj, SHARE_RATIO_PRECISION, d.token0Debt);
    const sharesFromT1 = mulDiv(t1Adj, SHARE_RATIO_PRECISION, d.token1Debt);
    if (sharesFromT0 > sharesFromT1) {
      shares = mulDiv(sharesFromT1, totalBorrowShares, SHARE_RATIO_PRECISION);
      excessT0 = t0Adj - mulDiv(sharesFromT1, t0Adj, sharesFromT0);
    } else if (sharesFromT1 > sharesFromT0) {
      shares = mulDiv(sharesFromT0, totalBorrowShares, SHARE_RATIO_PRECISION);
      excessT1 = t1Adj - mulDiv(sharesFromT0, t1Adj, sharesFromT1);
    } else {
      throw new DexMathError("INVALID_PAYBACK_AMOUNTS");
    }
    d2 = updatedDebtReserves(shares, totalBorrowShares, d);
    adjTotal = totalBorrowShares - shares;
  } else if (t0Adj > 0n) {
    excessT0 = t0Adj;
  } else if (t1Adj > 0n) {
    excessT1 = t1Adj;
  } else {
    throw new DexMathError("PAYBACK_AMOUNTS_ZERO");
  }
  let swapShares: bigint;
  if (excessT0 > 0n) {
    swapShares = getSwapAndPayback(
      d2.token0Debt,
      d2.token1Debt,
      d2.token0ImaginaryReserves,
      d2.token1ImaginaryReserves,
      excessT0
    );
  } else if (excessT1 > 0n) {
    swapShares = getSwapAndPayback(
      d2.token1Debt,
      d2.token0Debt,
      d2.token1ImaginaryReserves,
      d2.token0ImaginaryReserves,
      excessT1
    );
  } else {
    throw new DexMathError("PAYBACK_AMOUNTS_ZERO");
  }
  const extra = mulDiv(
    mulDiv(swapShares, adjTotal, SHARE_RATIO_PRECISION),
    fee,
    SIX_DECIMALS
  );
  return shares + extra;
}

// Native amounts become 9-decimal "adjusted" amounts, rounded against the
// user: deposits and paybacks shave a unit, withdraws and borrows add one.
function adjust(
  amount: bigint,
  decimals: number,
  roundUp: boolean,
  reserve: bigint,
  verify: (amount: bigint, total: bigint) => void
): bigint {
  if (amount <= 0n) {
    return 0n;
  }
  const adj = roundUp
    ? scale(amount + 1n, decimals) + 1n
    : scale(amount - 1n, decimals) - 1n;
  assertSwapAmountBounds(adj, amount);
  verify(adj, reserve);
  return adj;
}

function rawDeposit(
  cfg: UserOpConfig,
  pex: PricesAndExchangePrices,
  col: CollateralReserves,
  token0Amt: bigint,
  token1Amt: bigint,
  totalSupplyShares: bigint
): bigint {
  if (totalSupplyShares === 0n) {
    throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
  }
  const t0Adj = adjust(
    token0Amt,
    cfg.token0Decimals,
    false,
    col.token0RealReserves,
    verifyMint
  );
  const t1Adj = adjust(
    token1Amt,
    cfg.token1Decimals,
    false,
    col.token1RealReserves,
    verifyMint
  );
  if (t0Adj === 0n && t1Adj === 0n) {
    throw new DexMathError("DEPOSIT_AMOUNTS_ZERO");
  }
  const shares = computeDepositShares(
    t0Adj,
    t1Adj,
    col,
    totalSupplyShares,
    SIX_DECIMALS - cfg.fee
  );
  const t0 = col.token0RealReserves + t0Adj;
  const t1 = col.token1RealReserves + t1Adj;
  if (token0Amt > 0n) {
    assertToken1Reserves(t0, t1, pex.centerPrice);
  }
  if (token1Amt > 0n) {
    assertToken0Reserves(t0, t1, pex.centerPrice);
  }
  return shares;
}

function rawWithdraw(
  cfg: UserOpConfig,
  pex: PricesAndExchangePrices,
  col: CollateralReserves,
  token0Amt: bigint,
  token1Amt: bigint,
  totalSupplyShares: bigint
): bigint {
  if (totalSupplyShares === 0n) {
    throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
  }
  const r0 = col.token0RealReserves;
  const r1 = col.token1RealReserves;
  const t0Adj = adjust(token0Amt, cfg.token0Decimals, true, r0, verifyRedeem);
  const t1Adj = adjust(token1Amt, cfg.token1Decimals, true, r1, verifyRedeem);
  if (t0Adj === 0n && t1Adj === 0n) {
    throw new DexMathError("WITHDRAW_AMOUNTS_ZERO");
  }
  const shares = computeWithdrawShares(
    t0Adj,
    t1Adj,
    r0,
    r1,
    totalSupplyShares,
    pex,
    SIX_DECIMALS + cfg.fee
  );
  if (token0Amt > 0n) {
    assertToken0Reserves(r0 - t0Adj, r1 - t1Adj, pex.centerPrice);
  }
  if (token1Amt > 0n) {
    assertToken1Reserves(r0 - t0Adj, r1 - t1Adj, pex.centerPrice);
  }
  return shares;
}

function rawBorrow(
  cfg: UserOpConfig,
  pex: PricesAndExchangePrices,
  debt: DebtReserves,
  token0Amt: bigint,
  token1Amt: bigint,
  totalBorrowShares: bigint
): bigint {
  if (totalBorrowShares === 0n) {
    throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
  }
  const d0 = debt.token0Debt;
  const d1 = debt.token1Debt;
  const t0Adj = adjust(token0Amt, cfg.token0Decimals, true, d0, verifyMint);
  const t1Adj = adjust(token1Amt, cfg.token1Decimals, true, d1, verifyMint);
  if (t0Adj === 0n && t1Adj === 0n) {
    throw new DexMathError("BORROW_AMOUNTS_ZERO");
  }
  const shares = computeBorrowShares(
    t0Adj,
    t1Adj,
    d0,
    d1,
    totalBorrowShares,
    pex,
    SIX_DECIMALS + cfg.fee
  );
  if (token0Amt > 0n) {
    assertToken1Reserves(d0 + t0Adj, d1 + t1Adj, pex.centerPrice);
  }
  if (token1Amt > 0n) {
    assertToken0Reserves(d0 + t0Adj, d1 + t1Adj, pex.centerPrice);
  }
  return shares;
}

function rawPayback(
  cfg: UserOpConfig,
  pex: PricesAndExchangePrices,
  debt: DebtReserves,
  token0Amt: bigint,
  token1Amt: bigint,
  totalBorrowShares: bigint
): bigint {
  if (totalBorrowShares === 0n) {
    throw new DexMathError("SHARES_AMOUNT_INSUFFICIENT");
  }
  const d0 = debt.token0Debt;
  const d1 = debt.token1Debt;
  const t0Adj = adjust(token0Amt, cfg.token0Decimals, false, d0, verifyRedeem);
  const t1Adj = adjust(token1Amt, cfg.token1Decimals, false, d1, verifyRedeem);
  if (t0Adj === 0n && t1Adj === 0n) {
    throw new DexMathError("PAYBACK_AMOUNTS_ZERO");
  }
  const shares = computePaybackShares(
    t0Adj,
    t1Adj,
    debt,
    totalBorrowShares,
    SIX_DECIMALS - cfg.fee
  );
  if (token0Amt > 0n) {
    assertToken0Reserves(d0 - t0Adj, d1 - t1Adj, pex.centerPrice);
  }
  if (token1Amt > 0n) {
    assertToken1Reserves(d0 - t0Adj, d1 - t1Adj, pex.centerPrice);
  }
  return shares;
}

function perfectAmountsFromShares(
  shares: bigint,
  reserve0: bigint,
  reserve1: bigint,
  totalShares: bigint,
  cfg: UserOpConfig,
  roundUp: boolean
): { token0Amt: bigint; token1Amt: bigint } {
  const t0Adj = mulDiv(reserve0, shares, totalShares);
  const t1Adj = mulDiv(reserve1, shares, totalShares);
  if (roundUp) {
    return {
      token0Amt: descale(t0Adj + 1n, cfg.token0Decimals) + 1n,
      token1Amt: descale(t1Adj + 1n, cfg.token1Decimals) + 1n,
    };
  }
  if (t0Adj === 0n || t1Adj === 0n) {
    throw new DexMathError("PERFECT_ADJUSTED_AMOUNT_ZERO");
  }
  const token0Amt = descale(t0Adj - 1n, cfg.token0Decimals) - 1n;
  const token1Amt = descale(t1Adj - 1n, cfg.token1Decimals) - 1n;
  if (token0Amt <= 0n || token1Amt <= 0n) {
    throw new DexMathError("PERFECT_AMOUNTS_ROUND_TO_ZERO");
  }
  return { token0Amt, token1Amt };
}
