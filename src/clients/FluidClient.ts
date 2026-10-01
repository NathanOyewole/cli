import { ClientConfig } from "./ClientConfig.ts";
import type { LendMarket } from "./LendClient.ts";

export type Paginated<T> = {
  meta: { total: number; currentPage: number; lastPage: number };
  data: T[];
};

export type EarnHistoryEntry = {
  type: string;
  signature: string;
  from: string;
  to: string;
  ftoken: string;
  asset: string;
  sharesAmount: string;
  assetAmount: string;
  assetAmountUsd: string | null;
  status: string;
  createdAt: string;
};

export type ExchangePricePoint = {
  liquidityExchangePrice: number;
  tokenExchangePrice: number;
  date: string;
};

export type LendingStats = {
  totalDeposits: string;
  totalWithdraws: string;
  totalAssets: string;
  earnings: string;
};

export type VaultToken = {
  address: string;
  symbol: string;
  uiSymbol?: string;
  decimals: number;
  price: string;
  stakingApr?: number | string;
  nativeStakeVoteAccount?: string;
  // Token-2022 scaled UI amount (xStocks): UI amount = raw amount × multiplier.
  scaledUiConfig?: {
    multiplier: number;
    newMultiplier: number;
    newMultiplierEffectiveTimestamp: string;
  };
};

export type VaultSide = { token0: VaultToken; token1: VaultToken | null };

type SideRate = {
  liquidity: { token0: string; token1: string };
  vault: { rate: string; feeRate: string };
};

// A smart side's DEX pool snapshot: 9-decimal reserves and shares, 1e15
// prices, fee in 1e6 units. `token0Debt`/`token1Debt` only exist on debt pools.
export type DexData = {
  token0RealReserves: string;
  token1RealReserves: string;
  token0ImaginaryReserves: string;
  token1ImaginaryReserves: string;
  token0Debt?: string;
  token1Debt?: string;
  totalShares: string;
  maxShares: string;
  token0PerShare: string;
  token1PerShare: string;
  fee: string;
  pex: {
    centerPrice: string;
    upperRange: string;
    lowerRange: string;
    geometricMean: string;
  };
};

export type Vault = {
  id: number;
  type: number;
  address: string;
  supplyToken: VaultSide;
  borrowToken: VaultSide;
  supplyDexData?: DexData | null;
  borrowDexData?: DexData | null;
  totalSupply: string;
  totalBorrow: string;
  supplyRateMagnifier: string;
  borrowRateMagnifier: string;
  collateralFactor: string;
  liquidationThreshold: string;
  liquidationMaxLimit: string;
  liquidationPenalty: string;
  borrowFee: string;
  supplyRate: SideRate;
  borrowRate: SideRate;
  withdrawable: string;
  borrowable: string;
  minimumBorrowing: string;
  totalPositions: number;
  oraclePrice: string | null;
  rewards?: { side: "supply" | "borrow"; apr: string | number }[];
  metadata: {
    maxLeverage: boolean;
    nativeStake: boolean;
    pegged: boolean;
    multiply: { enabled: boolean; reduceFactor: number };
    earn: boolean;
  };
};

export type Nft = {
  id: number;
  vaultId: number;
  address: string;
  supply: string;
  borrow: string;
  dustBorrow: string;
  isLiquidated: boolean;
  ownerAddress: string;
  vault: Vault;
  config: { maxLeverage?: boolean };
};

export type NftPnl = {
  amount: string | number | null;
  percentage: string | number | null;
};

export type NftAction = {
  type: string;
  vaultId: number;
  nftId: number;
  signature: string;
  token0Collateral: string | null;
  token0CollateralUsd: string | null;
  token0Debt: string | null;
  token0DebtUsd: string | null;
  status: string;
  createdAt: string;
};

export type NftLiquidation = {
  txnSig: string;
  collateralAmount: string;
  debtAmount: string;
  liquidateOraclePrice: string | null;
  createdAt: string;
};

export type ExplorerPosition = {
  vaultId: number;
  nftId: number;
  owner: string;
  supply: string;
  borrow: string;
  ratio: number;
  healthFactor: string;
  isLiquidated: number;
  updatedAt: string;
};

export type LiquidityToken = {
  address: string;
  symbol: string;
  decimals: number;
  price: string;
  totalSupply: string;
  totalBorrow: string;
  supplyRate: string;
  borrowRate: string;
  lastStoredUtilization: string;
  maxUtilization: string;
};

export type DexPool = {
  id: number;
  address: string;
  token0: VaultToken;
  token1: VaultToken;
  [key: string]: unknown;
};

export type DexStats = {
  volume7dToken0: string;
  volume7dToken1: string;
  fee7dToken0: string;
  fee7dToken1: string;
  swapCount7d: number;
};

export type FlashloanPosition = {
  asset: string;
  borrowable: string;
  borrowLimit: string;
};

// The jup.ag lend UI reads market data straight from the Fluid indexer.
export class FluidClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://api.solana.fluid.io",
    timeout: 30_000,
  });

  public static async getEarnHistory(
    market: LendMarket,
    address: string,
    params: { page: number; type?: string; ftoken?: string }
  ): Promise<Paginated<EarnHistoryEntry>> {
    return this.#ky
      .get(`v1/${market}/lending/users/${address}/actions`, {
        searchParams: clean(params),
      })
      .json();
  }

  public static async getExchangePriceChart(
    market: LendMarket,
    jlToken: string,
    range: string
  ): Promise<ExchangePricePoint[]> {
    return this.#ky
      .get(`v1/${market}/lending/tokens/${jlToken}/charts/exchange-price`, {
        searchParams: { range },
      })
      .json();
  }

  public static async getLendingStats(
    market: LendMarket
  ): Promise<LendingStats> {
    return this.#ky.get(`v1/${market}/lending/stats`).json();
  }

  public static async getVaults(market: LendMarket): Promise<Vault[]> {
    return this.#ky.get(`v2/${market}/borrowing/vaults`).json();
  }

  public static async getVault(market: LendMarket, id: number): Promise<Vault> {
    return this.#ky.get(`v2/${market}/borrowing/vaults/${id}`).json();
  }

  public static async getUserNfts(
    market: LendMarket,
    address: string
  ): Promise<Nft[]> {
    return this.#ky.get(`v2/${market}/borrowing/users/${address}/nfts`).json();
  }

  public static async getNft(
    market: LendMarket,
    vaultId: number,
    nftId: number
  ): Promise<Nft> {
    return this.#ky
      .get(`v2/${market}/borrowing/vaults/${vaultId}/nfts/${nftId}`)
      .json();
  }

  public static async getNftPnl(
    market: LendMarket,
    vaultId: number,
    nftId: number
  ): Promise<NftPnl> {
    return this.#ky
      .get(`v2/${market}/borrowing/vaults/${vaultId}/nfts/${nftId}/pnl`)
      .json();
  }

  public static async getNftHistory(
    market: LendMarket,
    vaultId: number,
    nftId: number,
    page: number
  ): Promise<Paginated<NftAction>> {
    return this.#ky
      .get(`v2/${market}/borrowing/vaults/${vaultId}/nfts/${nftId}/actions`, {
        searchParams: { page },
      })
      .json();
  }

  public static async getNftLiquidations(
    market: LendMarket,
    vaultId: number,
    nftId: number,
    page: number
  ): Promise<Paginated<NftLiquidation>> {
    return this.#ky
      .get(
        `v1/${market}/borrowing/vaults/${vaultId}/nfts/${nftId}/liquidations`,
        { searchParams: { page }, timeout: 60_000 }
      )
      .json();
  }

  public static async getPositions(
    market: LendMarket,
    params: {
      page: number;
      vaultIds?: string;
      owner?: string;
      sortedBy?: string;
      sortedByDirection?: string;
      isLiquidated?: string;
    }
  ): Promise<Paginated<ExplorerPosition>> {
    return this.#ky
      .get(`v2/${market}/borrowing/positions`, { searchParams: clean(params) })
      .json();
  }

  public static async getLiquidityTokens(
    market: LendMarket
  ): Promise<LiquidityToken[]> {
    return this.#ky.get(`v1/${market}/liquidity/tokens`).json();
  }

  public static async getDexes(market: LendMarket): Promise<DexPool[]> {
    return this.#ky.get(`v1/${market}/dexes`).json();
  }

  public static async getDexStats(
    market: LendMarket,
    id: number
  ): Promise<DexStats> {
    return this.#ky.get(`v1/${market}/dexes/${id}/stats`).json();
  }

  public static async getFlashloanPositions(
    market: LendMarket
  ): Promise<FlashloanPosition[]> {
    return this.#ky.get(`v1/${market}/flashloan/positions`).json();
  }
}

function clean(
  params: Record<string, string | number | undefined>
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined)
  ) as Record<string, string | number>;
}
