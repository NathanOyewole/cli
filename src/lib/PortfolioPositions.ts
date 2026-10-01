import { NumberConverter } from "./NumberConverter.ts";

export type TokenInfoMap = Record<
  string,
  { symbol?: string; name?: string; decimals?: number }
>;

type RawAmount =
  | number
  | { fixed: true; raw: string; decimals: number }
  | { fixed?: false; value: number | string };

export type RawAsset = {
  type?: string;
  name?: string;
  value?: number | null;
  data?: {
    address?: string;
    amount?: RawAmount;
    price?: number | null;
  };
};

type RawPerpPosition = {
  address?: string;
  side: string;
  size?: number;
  sizeValue?: number;
  pnlValue?: number;
  value?: number;
  leverage?: number;
  entryPrice?: number;
  markPrice?: number;
  liquidationPrice?: number;
};

export type RawPortfolioElement = {
  type: string;
  label: string;
  name?: string | null;
  platformId: string;
  owner?: string;
  value?: number | null;
  netApy?: number | null;
  link?: string | null;
  data?: Record<string, unknown> & {
    link?: string;
  };
};

export type PositionAsset = {
  role: string;
  mint: string | null;
  symbol: string | null;
  amount: number | null;
  priceUsd: number | null;
  valueUsd: number | null;
};

export type PerpPosition = {
  side: string;
  mint: string | null;
  symbol: string | null;
  size: number | null;
  sizeUsd: number | null;
  pnlUsd: number | null;
  leverage: number | null;
  entryPriceUsd: number | null;
  markPriceUsd: number | null;
  liquidationPriceUsd: number | null;
  valueUsd: number | null;
};

export type Position = {
  owner: string;
  platformId: string;
  label: string;
  name: string | null;
  type: string;
  valueUsd: number | null;
  apyPct: number | null;
  healthRatio: number | null;
  assets: PositionAsset[];
  perps: PerpPosition[];
  link: string | null;
};

export function amountOf(amount: RawAmount | undefined): number | null {
  if (amount === undefined || amount === null) {
    return null;
  }
  if (typeof amount === "number") {
    return amount;
  }
  if ("raw" in amount) {
    return Number(NumberConverter.fromChainAmount(amount.raw, amount.decimals));
  }
  return Number(amount.value);
}

function toAsset(
  role: string,
  asset: RawAsset,
  tokens: TokenInfoMap
): PositionAsset {
  const mint = asset.data?.address ?? null;
  return {
    role,
    mint,
    symbol: (mint ? tokens[mint]?.symbol : undefined) ?? asset.name ?? null,
    amount: amountOf(asset.data?.amount),
    priceUsd: asset.data?.price ?? null,
    valueUsd: asset.value ?? null,
  };
}

function assetList(value: unknown): RawAsset[] {
  return Array.isArray(value) ? (value as RawAsset[]) : [];
}

function toPerp(p: RawPerpPosition, tokens: TokenInfoMap): PerpPosition {
  const mint = p.address ?? null;
  return {
    side: p.side,
    mint,
    symbol: mint ? (tokens[mint]?.symbol ?? null) : null,
    size: p.size ?? null,
    sizeUsd: p.sizeValue ?? null,
    pnlUsd: p.pnlValue ?? null,
    leverage: p.leverage ?? null,
    entryPriceUsd: p.entryPrice ?? null,
    markPriceUsd: p.markPrice ?? null,
    liquidationPriceUsd: p.liquidationPrice ?? null,
    valueUsd: p.value ?? null,
  };
}

/**
 * Flattens a Portfolio API element (v1 or v2) of any `type` into one shape:
 * a list of assets tagged with their role, plus perps positions.
 */
export function normalizeElement(
  el: RawPortfolioElement,
  owner: string,
  tokens: TokenInfoMap
): Position {
  const data = el.data ?? {};
  const assets: PositionAsset[] = [];
  const perps: PerpPosition[] = [];

  switch (el.type) {
    case "multiple":
      assets.push(
        ...assetList(data.assets).map((a) => toAsset("asset", a, tokens))
      );
      break;
    case "liquidity":
      for (const liq of (data.liquidities as Record<string, unknown>[]) ?? []) {
        assets.push(
          ...assetList(liq.assets).map((a) => toAsset("asset", a, tokens)),
          ...assetList(liq.rewardAssets).map((a) =>
            toAsset("reward", a, tokens)
          )
        );
      }
      break;
    case "borrowlend":
      assets.push(
        ...assetList(data.suppliedAssets).map((a) =>
          toAsset("supplied", a, tokens)
        ),
        ...assetList(data.borrowedAssets).map((a) =>
          toAsset("borrowed", a, tokens)
        ),
        ...assetList(data.rewardAssets).map((a) => toAsset("reward", a, tokens))
      );
      break;
    case "trade": {
      const pair = (data.assets ?? {}) as {
        input?: RawAsset;
        output?: RawAsset;
      };
      if (pair.input) {
        assets.push(toAsset("input", pair.input, tokens));
      }
      if (pair.output) {
        assets.push(toAsset("output", pair.output, tokens));
      }
      break;
    }
    case "leverage": {
      const lev = data as {
        isolated?: { positions?: RawPerpPosition[] };
        cross?: {
          positions?: RawPerpPosition[];
          collateralAssets?: RawAsset[];
        };
      };
      perps.push(
        ...(lev.isolated?.positions ?? []).map((p) => toPerp(p, tokens)),
        ...(lev.cross?.positions ?? []).map((p) => toPerp(p, tokens))
      );
      assets.push(
        ...assetList(lev.cross?.collateralAssets).map((a) =>
          toAsset("collateral", a, tokens)
        )
      );
      break;
    }
  }

  return {
    owner: el.owner ?? owner,
    platformId: el.platformId,
    label: el.label,
    name: el.name ?? null,
    type: el.type,
    valueUsd: el.value ?? null,
    apyPct:
      el.netApy === undefined || el.netApy === null ? null : el.netApy * 100,
    healthRatio: typeof data.healthRatio === "number" ? data.healthRatio : null,
    assets,
    perps,
    link: el.link ?? data.link ?? null,
  };
}

export function mintsOf(elements: RawPortfolioElement[]): string[] {
  const mints = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "address" && typeof v === "string") {
          mints.add(v);
        } else if (k !== "sourceRefs") {
          visit(v);
        }
      }
    }
  };
  elements.forEach((el) => visit(el.data));
  return [...mints];
}
