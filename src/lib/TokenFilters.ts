import { InvalidArgumentError, Option, type Command } from "commander";

import { OptionParsers } from "./OptionParsers.ts";

type FilterKind = "flag" | "number" | "list";

type FilterDef = {
  key: string;
  flag: string;
  kind: FilterKind;
  description: string;
  perInterval?: boolean;
  maxItems?: number;
};

export type TokenFilterValues = Record<string, boolean | number | string[]>;

const BOOLEAN_FILTERS: [string, string][] = [
  ["verified", "Only verified tokens"],
  ["mintAuthorityDisabled", "Only tokens with mint authority disabled"],
  ["freezeAuthorityDisabled", "Only tokens with freeze authority disabled"],
  ["iconReused", "Only tokens whose icon is reused by another token"],
  ["smallMeteoraDBC", "Include small Meteora DBC launches"],
  ["hasSocials", "Only tokens with social links"],
  ["isPumpLive", "Only tokens live-streaming on pump.fun"],
  ["onlyCto", "Only community takeovers"],
  ["onlyDexPaid", "Only tokens with a paid DEX Screener profile"],
  ["onlyDexBoost", "Only tokens with an active DEX Screener boost"],
  ["onlyDevSold", "Only tokens whose dev has sold"],
  ["onlyDevHolding", "Only tokens whose dev still holds"],
  ["onlyStable", "Only plain stablecoins"],
  ["onlyYb", "Only yield-bearing stablecoins"],
];

const NUMBER_FILTERS: [string, string][] = [
  ["lpBurntPercentage", "Minimum LP burnt %"],
  ["topHoldersPercentage", "Maximum top-10 holders %"],
  ["numOfSocials", "Minimum number of social links"],
];

const RANGE_FILTERS: [string, string, boolean?][] = [
  ["Mcap", "market cap (USD)"],
  ["Liquidity", "liquidity (USD)"],
  ["Volume", "volume in the interval (USD)", true],
  ["NetVolume", "net buy volume in the interval (USD)", true],
  ["Txns", "transactions in the interval", true],
  ["Buys", "buys in the interval", true],
  ["Sells", "sells in the interval", true],
  ["NumNetBuyers", "net buyers in the interval", true],
  ["HolderCount", "holder count"],
  ["OrganicScore", "organic score (0-100)"],
  ["BondingCurve", "bonding curve progress %"],
  ["TokenAge", "token age (minutes)"],
  ["BondedAge", "time since graduation (minutes)"],
  ["Fees", "fees paid (SOL)"],
  ["TopHoldersPercentage", "top-10 holders %"],
  ["DevBalancePct", "dev holdings %"],
  ["DevMigrations", "dev migrations"],
  ["SniperPct", "sniper holdings %"],
  ["InsiderPct", "insider holdings %"],
  ["BundlerPct", "bundler holdings %"],
  ["BotHoldersPercentage", "bot holders %"],
  ["BotHoldersCount", "bot holders"],
  ["TwitterFollowers", "Twitter followers"],
  ["TwitterFollowing", "Twitter following"],
  ["TwitterReuseCount", "Twitter handle reuse count"],
  ["TweetAgeSec", "tweet age (seconds)"],
];

const LIST_FILTERS: FilterDef[] = [
  {
    key: "launchpads",
    flag: "launchpad",
    kind: "list",
    description: "Comma-separated launchpads (e.g. pump.fun,met-dbc,bags.fun)",
  },
  {
    key: "twitterHandles",
    flag: "twitter-handles",
    kind: "list",
    description: "Comma-separated Twitter handles (max 10)",
    maxItems: 10,
  },
  {
    key: "searchInclude",
    flag: "search-include",
    kind: "list",
    description: "Comma-separated keywords to include (max 5)",
    maxItems: 5,
  },
  {
    key: "searchExclude",
    flag: "search-exclude",
    kind: "list",
    description: "Comma-separated keywords to exclude (max 5)",
    maxItems: 5,
  },
];

function toFlag(key: string): string {
  return key
    .replace("DBC", "Dbc")
    .replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function toAttribute(flag: string): string {
  return flag
    .split("-")
    .map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join("");
}

const DEFS: FilterDef[] = [
  ...BOOLEAN_FILTERS.map(([key, description]) => ({
    key,
    flag: toFlag(key),
    kind: "flag" as const,
    description,
  })),
  ...NUMBER_FILTERS.map(([key, description]) => ({
    key,
    flag: toFlag(key),
    kind: "number" as const,
    description,
  })),
  ...RANGE_FILTERS.flatMap(([name, label, perInterval]) =>
    (["min", "max"] as const).map((bound) => ({
      key: `${bound}${name}`,
      flag: toFlag(`${bound}${name}`),
      kind: "number" as const,
      description: `${bound === "min" ? "Minimum" : "Maximum"} ${label}`,
      perInterval: perInterval ?? false,
    }))
  ),
  ...LIST_FILTERS,
];

export class TokenFilters {
  public static addOptions(cmd: Command): Command {
    for (const def of DEFS) {
      const flags =
        def.kind === "flag"
          ? `--${def.flag}`
          : `--${def.flag} <${def.kind === "list" ? "list" : "n"}>`;
      const option = new Option(flags, `Filter: ${def.description}`);
      if (def.kind === "number") {
        option.argParser(OptionParsers.number);
      }
      if (def.kind === "list") {
        option.argParser((value: string) => {
          const items = OptionParsers.list(value);
          if (def.maxItems && items.length > def.maxItems) {
            throw new InvalidArgumentError(
              `At most ${def.maxItems} values allowed.`
            );
          }
          return items;
        });
      }
      cmd.addOption(option);
    }
    return cmd;
  }

  public static fromOptions(opts: Record<string, unknown>): TokenFilterValues {
    const filters: TokenFilterValues = {};
    for (const def of DEFS) {
      const value = opts[toAttribute(def.flag)];
      if (value === undefined) {
        continue;
      }
      filters[def.key] = value as boolean | number | string[];
    }
    return filters;
  }

  public static resolve(
    filters: TokenFilterValues,
    interval: string
  ): TokenFilterValues {
    const perInterval = new Set(
      DEFS.filter((d) => d.perInterval).map((d) => d.key)
    );
    return Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [
        perInterval.has(key) ? `${key}${interval}` : key,
        value,
      ])
    );
  }

  public static toSearchParams(
    filters: TokenFilterValues
  ): Record<string, string | number | boolean> {
    return Object.fromEntries(
      Object.entries(filters).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(",") : value,
      ])
    );
  }
}
