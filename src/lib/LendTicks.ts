// Port of the @jup-ag/lend vault tick math: tick <-> ratio conversion, the
// tick-has-debt bitmap layout, liquidation branch reconciliation and the
// position a collateral/debt change lands on. Pure bigint math; callers feed
// it decoded on-chain accounts.

export const MIN_TICK = -16383;
export const MAX_TICK = 16383;
export const INIT_TICK = -2147483648;
export const MIN_I128 = -(2n ** 127n);
export const MAX_I128 = 2n ** 127n - 1n;

const ZERO_TICK_SCALED_RATIO = 2n ** 48n;
const TICK_HAS_DEBT_ARRAY_SIZE = 8;
const TICKS_PER_TICK_HAS_DEBT = TICK_HAS_DEBT_ARRAY_SIZE * 256;
const TICK_HAS_DEBT_CHILDREN_SIZE = 32;
const TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS = 256;
const TOTAL_INDICES_NEEDED = 16;
const EXCHANGE_PRICES_PRECISION = 10n ** 12n;
const TICK_SPACING = 10015n;
const X30 = 1073741823n;
const MAX_TOKEN_DECIMALS = 9;
const LOWER_DECIMALS_OPERATE = 4;

const EXPONENT_SIZE_DEBT_FACTOR = 15n;
const COEFFICIENT_SIZE_DEBT_FACTOR = 35n;
const EXPONENT_MAX_DEBT_FACTOR = (1n << EXPONENT_SIZE_DEBT_FACTOR) - 1n;
const DECIMALS_DEBT_FACTOR = 16384n;
const MAX_MASK_DEBT_FACTOR =
  (1n << (COEFFICIENT_SIZE_DEBT_FACTOR + EXPONENT_SIZE_DEBT_FACTOR)) - 1n;
const TWO_POWER_64 = 18446744073709551615n;
const TWO_POWER_69_MINUS_1 = (1n << 69n) - 1n;

const RATIO_FACTORS = [
  18419115400608638658n,
  18391528108445969703n,
  18336477419114433396n,
  18226869890870665593n,
  18009616477100071088n,
  17582847377087825313n,
  16759408633341240198n,
  15226414841393184936n,
  12568272644527235157n,
  8563108841104354677n,
  3975055583337633975n,
  856577552520149366n,
  39775317560084773n,
  85764505686420n,
  398745188n,
];

const TICK_STEPS: [number, bigint][] = [
  [8192, 2150859953785115391n],
  [4096, 4637736467054931n],
  [2048, 215354044936586n],
  [1024, 46406254420777n],
  [512, 21542110950596n],
  [256, 14677230989051n],
  [128, 12114962232319n],
  [64, 11006798913544n],
  [32, 10491329235871n],
  [16, 10242718992470n],
  [8, 10120631893548n],
  [4, 10060135135051n],
  [2, 10030022500000n],
];

export type PositionAccount = {
  nftId: number;
  isSupplyOnlyPosition: number;
  tick: number;
  tickId: number;
  supplyAmount: bigint;
  dustDebtAmount: bigint;
};

export type TickAccount = {
  isLiquidated: number;
  totalIds: number;
  isFullyLiquidated: number;
  liquidationBranchId: number;
  debtFactor: bigint;
};

export type TickIdLiquidationAccount = {
  isFullyLiquidated: [number, number, number];
  liquidationBranchId: [number, number, number];
  debtFactor: [bigint, bigint, bigint];
};

export type BranchAccount = {
  branchId: number;
  status: number;
  minimaTick: number;
  minimaTickPartials: number;
  debtFactor: bigint;
  connectedBranchId: number;
};

export type PositionState = {
  tick: number;
  tickId: number;
  colRaw: bigint;
  debtRaw: bigint;
  dustDebtRaw: bigint;
  userLiquidationStatus: boolean;
  postLiquidationBranchId: number;
};

export class LendTicks {
  public static ratioAtTick(tick: number): bigint {
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error(`Tick ${tick} out of range [${MIN_TICK}, ${MAX_TICK}]`);
    }
    const absTick = Math.abs(tick);
    let factor = absTick & 1 ? RATIO_FACTORS[0]! : 18446744073709551616n;
    for (let bit = 1; bit < RATIO_FACTORS.length; bit++) {
      if (absTick & (1 << bit)) {
        factor = (factor * RATIO_FACTORS[bit]!) >> 64n;
      }
    }
    let precision = 0n;
    if (tick > 0) {
      factor = (2n ** 128n - 1n) / factor;
      if (factor % 65536n !== 0n) {
        precision = 1n;
      }
    }
    return (factor >> 16n) + precision;
  }

  public static tickAtRatio(ratioX48: bigint): number {
    if (ratioX48 < 6093n || ratioX48 > 13002088162051014298412982n) {
      throw new Error(`Ratio ${ratioX48} out of bounds`);
    }
    const scale = 10_000_000_000_000n;
    const isNegative = ratioX48 < ZERO_TICK_SCALED_RATIO;
    let factor = isNegative
      ? (ZERO_TICK_SCALED_RATIO * scale) / ratioX48
      : (ratioX48 * scale) / ZERO_TICK_SCALED_RATIO;
    let tick = 0;
    for (const [bit, step] of TICK_STEPS) {
      if (factor >= step) {
        tick |= bit;
        factor = (factor * scale) / step;
      }
    }
    if (factor >= 10015000000000n) {
      tick |= 1;
    }
    return isNegative ? ~tick : tick;
  }

  public static tickIndices(tick: number): {
    arrayIndex: number;
    mapIndex: number;
    byteIndex: number;
    bitIndex: number;
  } {
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error("Tick out of range");
    }
    const arrayIndex = Math.floor((tick - MIN_TICK) / TICKS_PER_TICK_HAS_DEBT);
    const tickWithinArray = tick - this.firstTickForIndex(arrayIndex);
    const mapIndex = Math.floor(
      tickWithinArray / TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS
    );
    const tickWithinMap = tickWithinArray % TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS;
    return {
      arrayIndex,
      mapIndex,
      byteIndex: Math.floor(tickWithinMap / 8),
      bitIndex: tickWithinMap % 8,
    };
  }

  // Highest tick with debt strictly below `startTick`, walking down the
  // tick-has-debt bitmaps. `readArray` returns an array's 8 x 32-byte maps.
  public static async nextTickWithDebt(
    startTick: number,
    readArray: (index: number) => Promise<Uint8Array[] | null>
  ): Promise<number> {
    try {
      const { arrayIndex, mapIndex, byteIndex, bitIndex } =
        this.tickIndices(startTick);
      let currentArray = arrayIndex;
      let currentMap = mapIndex;
      let maps = await readArray(currentArray);
      if (!maps) {
        return MIN_TICK;
      }
      const bitmap = [...maps[mapIndex]!];
      bitmap[byteIndex] =
        bitIndex > 0 ? bitmap[byteIndex]! & ((1 << bitIndex) - 1) : 0;
      for (let i = byteIndex + 1; i < TICK_HAS_DEBT_CHILDREN_SIZE; i++) {
        bitmap[i] = 0;
      }
      maps = maps.map((m, i) => (i === mapIndex ? Uint8Array.from(bitmap) : m));
      while (true) {
        const next = this.topTickInMaps(maps, currentArray, currentMap);
        if (next !== null && next !== MIN_TICK) {
          return next;
        }
        if (currentArray === 0) {
          return MIN_TICK;
        }
        currentArray -= 1;
        currentMap = TICK_HAS_DEBT_ARRAY_SIZE - 1;
        maps = await readArray(currentArray);
        if (!maps) {
          return MIN_TICK;
        }
      }
    } catch {
      return MIN_TICK;
    }
  }

  public static minimumDebt(decimals: number): bigint {
    if (decimals > MAX_TOKEN_DECIMALS) {
      throw new Error(`Unsupported token decimals: ${decimals}`);
    }
    const base = decimals >= LOWER_DECIMALS_OPERATE ? 1000n : 10n;
    return base * 10n ** BigInt(MAX_TOKEN_DECIMALS - decimals);
  }

  // A position's live collateral and debt (raw vault units), following any
  // liquidation that hit its tick through the branch chain.
  public static currentPosition(p: {
    position: PositionAccount;
    tickData: TickAccount | null;
    tickIdData: TickIdLiquidationAccount | null;
    branches: BranchAccount[];
    borrowMintDecimals: number;
  }): PositionState {
    const { position } = p;
    const positionTick = position.tick === INIT_TICK ? MIN_TICK : position.tick;
    if (position.isSupplyOnlyPosition) {
      return {
        tick: MIN_TICK,
        tickId: 0,
        colRaw: position.supplyAmount,
        debtRaw: 0n,
        dustDebtRaw: 0n,
        userLiquidationStatus: false,
        postLiquidationBranchId: 0,
      };
    }
    const colRaw = position.supplyAmount;
    const dustDebtRaw = position.dustDebtAmount;
    const debtRaw =
      positionTick > MIN_TICK
        ? ((this.ratioAtTick(positionTick) * (colRaw + 1n)) >> 48n) + 1n
        : 0n;
    const tickData = p.tickData;
    if (
      positionTick > MIN_TICK &&
      tickData &&
      (tickData.isLiquidated || tickData.totalIds > position.tickId)
    ) {
      const status = this.liquidationStatus(
        position.tickId,
        tickData,
        p.tickIdData
      );
      if (status.isFullyLiquidated) {
        return {
          tick: MIN_TICK,
          tickId: 0,
          colRaw: 0n,
          debtRaw: 0n,
          dustDebtRaw: 0n,
          userLiquidationStatus: true,
          postLiquidationBranchId: 0,
        };
      }
      const liquidated = this.processLiquidatedPosition(
        p.branches,
        status.branchId,
        status.connectionFactor,
        debtRaw
      );
      const absorbThreshold = this.minimumDebt(p.borrowMintDecimals) * 2n;
      const isWiped =
        liquidated.finalDebtRaw < dustDebtRaw ||
        liquidated.finalDebtRaw < absorbThreshold;
      return isWiped
        ? {
            tick: MIN_TICK,
            tickId: 0,
            colRaw: 0n,
            debtRaw: 0n,
            dustDebtRaw: 0n,
            userLiquidationStatus: true,
            postLiquidationBranchId: 0,
          }
        : {
            tick: liquidated.finalTick,
            tickId: position.tickId,
            colRaw: liquidated.finalColRaw,
            debtRaw: liquidated.finalDebtRaw,
            dustDebtRaw,
            userLiquidationStatus: true,
            postLiquidationBranchId: status.branchId,
          };
    }
    return {
      tick: positionTick,
      tickId: position.tickId,
      colRaw,
      debtRaw,
      dustDebtRaw,
      userLiquidationStatus: false,
      postLiquidationBranchId: 0,
    };
  }

  // The tick a position lands on after `newCol`/`newDebt` (signed, 9-decimal
  // vault units; i128::MIN means "all of it").
  public static finalTick(p: {
    current: PositionState;
    newCol: bigint;
    newDebt: bigint;
    supplyExchangePrice: bigint;
    borrowExchangePrice: bigint;
    borrowFee: number;
  }): number {
    let { colRaw, debtRaw } = p.current;
    if (p.newCol > 0n) {
      colRaw += (p.newCol * EXCHANGE_PRICES_PRECISION) / p.supplyExchangePrice;
    } else if (p.newCol < 0n) {
      colRaw =
        p.newCol === MIN_I128
          ? 0n
          : colRaw -
            divCeil(
              -p.newCol * EXCHANGE_PRICES_PRECISION,
              p.supplyExchangePrice
            );
    }
    if (p.newDebt > 0n) {
      const borrowRaw = divCeil(
        p.newDebt * EXCHANGE_PRICES_PRECISION,
        p.borrowExchangePrice
      );
      debtRaw += borrowRaw + divCeil(borrowRaw * BigInt(p.borrowFee), 10_000n);
    } else if (p.newDebt < 0n) {
      debtRaw =
        p.newDebt === MIN_I128
          ? 0n
          : debtRaw -
            ((-p.newDebt * EXCHANGE_PRICES_PRECISION) / p.borrowExchangePrice -
              1n);
    }
    const dust = p.current.dustDebtRaw;
    const netDebtRaw = debtRaw > dust ? debtRaw - dust : 0n;
    if (netDebtRaw === 0n || colRaw === 0n) {
      return MIN_TICK;
    }
    const marginAdjustedDebt = (netDebtRaw * 1000000001n) / 1_000_000_000n + 1n;
    const tick =
      this.tickAtRatio((marginAdjustedDebt * ZERO_TICK_SCALED_RATIO) / colRaw) +
      1;
    return Math.min(MAX_TICK, Math.max(MIN_TICK, tick));
  }

  private static firstTickForIndex(index: number): number {
    if (index >= TOTAL_INDICES_NEEDED) {
      throw new Error(
        `Invalid index: ${index}. Must be between 0 and ${TOTAL_INDICES_NEEDED - 1}`
      );
    }
    return MIN_TICK + index * TICKS_PER_TICK_HAS_DEBT;
  }

  private static topTickInMaps(
    maps: Uint8Array[],
    arrayIndex: number,
    startMap: number
  ): number | null {
    for (let mapIndex = startMap; mapIndex >= 0; mapIndex--) {
      const bits = maps[mapIndex]!;
      for (let byte = TICK_HAS_DEBT_CHILDREN_SIZE - 1; byte >= 0; byte--) {
        const value = bits[byte]!;
        if (value !== 0) {
          const bit = 31 - Math.clz32(value);
          return (
            this.firstTickForIndex(arrayIndex) +
            mapIndex * TICK_HAS_DEBT_CHILDREN_SIZE_IN_BITS +
            byte * 8 +
            bit
          );
        }
      }
    }
    return null;
  }

  private static liquidationStatus(
    positionTickId: number,
    tick: TickAccount,
    tickId: TickIdLiquidationAccount | null
  ): {
    isFullyLiquidated: boolean;
    branchId: number;
    connectionFactor: bigint;
  } {
    if (tick.totalIds === positionTickId) {
      return {
        isFullyLiquidated: tick.isFullyLiquidated === 1,
        branchId: tick.liquidationBranchId,
        connectionFactor: tick.debtFactor,
      };
    }
    const set = (positionTickId + 2) % 3;
    return {
      isFullyLiquidated: tickId?.isFullyLiquidated[set] === 1,
      branchId: tickId?.liquidationBranchId[set] ?? 0,
      connectionFactor: tickId?.debtFactor[set] ?? 0n,
    };
  }

  private static processLiquidatedPosition(
    branches: BranchAccount[],
    branchId: number,
    connectionFactor: bigint,
    initialDebtRaw: bigint
  ): { finalTick: number; finalColRaw: bigint; finalDebtRaw: bigint } {
    const byId = new Map(branches.map((b) => [b.branchId, b]));
    let factor = connectionFactor;
    let branch = byId.get(branchId);
    if (!branch) {
      throw new Error(`Branch ${branchId} not found`);
    }
    while (branch.status === 2) {
      factor = mulBigNumber(factor, branch.debtFactor);
      if (factor === MAX_MASK_DEBT_FACTOR) {
        break;
      }
      const connected: BranchAccount | undefined = byId.get(
        branch.connectedBranchId
      );
      if (!connected) {
        throw new Error(
          `Connected branch ${branch.connectedBranchId} not found`
        );
      }
      branch = connected;
    }
    if (branch.status === 3 || factor === MAX_MASK_DEBT_FACTOR) {
      return { finalTick: MIN_TICK, finalColRaw: 0n, finalDebtRaw: 0n };
    }
    let debt = mulDivNormal(initialDebtRaw, branch.debtFactor, factor);
    debt = debt > initialDebtRaw / 100n ? (debt * 9999n) / 10_000n : 0n;
    if (debt === 0n) {
      return { finalTick: MIN_TICK, finalColRaw: 0n, finalDebtRaw: 0n };
    }
    const ratioAtTick = this.ratioAtTick(branch.minimaTick);
    const ratioOneLess = (ratioAtTick * 10_000n) / TICK_SPACING;
    const finalRatio =
      ratioOneLess +
      ((ratioAtTick - ratioOneLess) * BigInt(branch.minimaTickPartials)) / X30;
    return {
      finalTick: branch.minimaTick,
      finalColRaw: (debt * ZERO_TICK_SCALED_RATIO) / finalRatio,
      finalDebtRaw: debt,
    };
  }
}

function divCeil(numerator: bigint, denominator: bigint): bigint {
  const div = numerator / denominator;
  return numerator % denominator === 0n ? div : div + 1n;
}

function mulDivNormal(normal: bigint, big1: bigint, big2: bigint): bigint {
  if (big1 === 0n || big2 === 0n) {
    return 0n;
  }
  const exponent1 = big1 & EXPONENT_MAX_DEBT_FACTOR;
  const exponent2 = big2 & EXPONENT_MAX_DEBT_FACTOR;
  if (exponent2 < exponent1) {
    throw new Error("LibraryBnError: exponent2 should be >= exponent1");
  }
  const netExponent = exponent2 - exponent1;
  if (netExponent >= 129n) {
    return 0n;
  }
  const numerator = normal * (big1 >> EXPONENT_SIZE_DEBT_FACTOR);
  const denominator = (big2 >> EXPONENT_SIZE_DEBT_FACTOR) << netExponent;
  if (denominator === 0n) {
    throw new Error("LibraryDivisionByZero");
  }
  const result = numerator / denominator;
  if (result > TWO_POWER_64) {
    throw new Error("LibraryBnError: result overflow");
  }
  return result;
}

function mulBigNumber(big1: bigint, big2: bigint): bigint {
  const coefficient =
    (big1 >> EXPONENT_SIZE_DEBT_FACTOR) * (big2 >> EXPONENT_SIZE_DEBT_FACTOR);
  const overflowLen =
    coefficient > TWO_POWER_69_MINUS_1
      ? COEFFICIENT_SIZE_DEBT_FACTOR
      : COEFFICIENT_SIZE_DEBT_FACTOR - 1n;
  const exponent =
    (big1 & EXPONENT_MAX_DEBT_FACTOR) +
    (big2 & EXPONENT_MAX_DEBT_FACTOR) +
    overflowLen;
  if (exponent < DECIMALS_DEBT_FACTOR) {
    throw new Error("LibraryBnError: exponent underflow");
  }
  const finalExponent = exponent - DECIMALS_DEBT_FACTOR;
  if (finalExponent > EXPONENT_MAX_DEBT_FACTOR) {
    return MAX_MASK_DEBT_FACTOR;
  }
  return (
    ((coefficient >> overflowLen) << EXPONENT_SIZE_DEBT_FACTOR) | finalExponent
  );
}
