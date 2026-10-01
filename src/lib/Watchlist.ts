import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Config } from "./Config.ts";

// Mirrors the jup.ag web app's `intel_watchlist_config` localStorage value so
// the file can be copied to or from the browser unchanged.
export type WatchlistEntry =
  | {
      kind: "token";
      id: string;
      symbol: string;
      icon?: string | null | undefined;
      addedTimestamp: number;
    }
  | {
      kind: "stock";
      id: string;
      symbol: string;
      name: string;
      icon?: string | null | undefined;
      addedTimestamp: number;
    };

export type WatchlistData = {
  name: string;
  entries: WatchlistEntry[];
  createdAt: number;
};

export type WatchlistConfig = {
  watchlists: WatchlistData[];
  activeWatchlistName: string;
  display: Record<string, unknown>;
  dirty: boolean;
};

export class Watchlist {
  public static readonly FILE = join(Config.CONFIG_DIR, "watchlist.json");
  public static readonly DEFAULT_NAME = "Default";
  public static readonly MAX_WATCHLISTS = 10;
  public static readonly MAX_NAME_LENGTH = 15;

  public static defaultConfig(): WatchlistConfig {
    return {
      watchlists: [
        {
          name: this.DEFAULT_NAME,
          entries: [
            {
              kind: "token",
              id: "So11111111111111111111111111111111111111112",
              symbol: "SOL",
              icon: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
              addedTimestamp: 0,
            },
            {
              kind: "token",
              id: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
              symbol: "JUP",
              icon: "https://static.jup.ag/jup/icon.png",
              addedTimestamp: 1,
            },
          ],
          createdAt: 0,
        },
      ],
      activeWatchlistName: this.DEFAULT_NAME,
      display: {
        metricV1: "usdPrice",
        timeframe: "24h",
        sort: "reOrderedList",
        sortDirection: "asc",
        showTokenIcon: true,
        showPriceChange: true,
        view: "chart",
      },
      dirty: false,
    };
  }

  public static load(): WatchlistConfig {
    if (!existsSync(this.FILE)) {
      return this.defaultConfig();
    }
    try {
      return this.parse(JSON.parse(readFileSync(this.FILE, "utf-8")));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not read ${this.FILE}: ${message}. Fix the file or remove it to reset your watchlists.`
      );
    }
  }

  public static save(config: WatchlistConfig): void {
    writeFileSync(this.FILE, JSON.stringify(config, null, 2) + "\n");
  }

  public static parse(raw: unknown): WatchlistConfig {
    const o = raw as Partial<WatchlistConfig> | null;
    if (!o || !Array.isArray(o.watchlists)) {
      throw new Error("expected an object with a `watchlists` array");
    }
    const defaults = this.defaultConfig();
    const watchlists = o.watchlists.map((w) => {
      const legacy = w as WatchlistData & { tokens?: WatchlistEntry[] };
      if (typeof legacy.name !== "string") {
        throw new Error("every watchlist needs a `name`");
      }
      return {
        name: legacy.name,
        entries: (legacy.entries ?? legacy.tokens ?? []).map((e) => ({
          ...e,
          kind: e.kind ?? "token",
        })) as WatchlistEntry[],
        createdAt: typeof legacy.createdAt === "number" ? legacy.createdAt : 0,
      };
    });
    return {
      watchlists,
      activeWatchlistName:
        typeof o.activeWatchlistName === "string"
          ? o.activeWatchlistName
          : defaults.activeWatchlistName,
      display: { ...defaults.display, ...(o.display ?? {}) },
      dirty: o.dirty ?? true,
    };
  }

  public static get(config: WatchlistConfig, name?: string): WatchlistData {
    const target = name ?? config.activeWatchlistName;
    const list =
      config.watchlists.find((w) => w.name === target) ??
      (name ? undefined : config.watchlists[0]);
    if (!list) {
      throw new Error(
        `Watchlist "${target}" not found. Lists: ${config.watchlists.map((w) => w.name).join(", ")}`
      );
    }
    return list;
  }

  public static add(
    config: WatchlistConfig,
    entry: WatchlistEntry,
    name: string | undefined,
    now: number
  ): { config: WatchlistConfig; added: boolean } {
    const target = name ?? this.get(config).name;
    let watchlists = config.watchlists;
    if (!watchlists.some((w) => w.name === target)) {
      if (target.length > this.MAX_NAME_LENGTH) {
        throw new Error(
          `Watchlist names can be at most ${this.MAX_NAME_LENGTH} characters.`
        );
      }
      if (watchlists.length >= this.MAX_WATCHLISTS) {
        throw new Error(
          `You can have at most ${this.MAX_WATCHLISTS} watchlists.`
        );
      }
      watchlists = [
        ...watchlists,
        { name: target, entries: [], createdAt: now },
      ];
    }
    let added = false;
    watchlists = watchlists.map((w) => {
      if (w.name !== target || w.entries.some((e) => this.isSame(e, entry))) {
        return w;
      }
      added = true;
      return { ...w, entries: [...w.entries, entry] };
    });
    return { config: { ...config, watchlists, dirty: true }, added };
  }

  public static remove(
    config: WatchlistConfig,
    entry: Pick<WatchlistEntry, "kind" | "id">,
    name: string | undefined
  ): { config: WatchlistConfig; removed: boolean } {
    const target = this.get(config, name).name;
    let removed = false;
    const watchlists = config.watchlists.map((w) => {
      if (w.name !== target) {
        return w;
      }
      const entries = w.entries.filter((e) => !this.isSame(e, entry));
      removed = entries.length !== w.entries.length;
      return { ...w, entries };
    });
    return { config: { ...config, watchlists, dirty: true }, removed };
  }

  public static deleteList(
    config: WatchlistConfig,
    name: string
  ): WatchlistConfig {
    this.get(config, name);
    if (config.watchlists.length === 1) {
      throw new Error("Cannot delete your only watchlist.");
    }
    const watchlists = config.watchlists.filter((w) => w.name !== name);
    return {
      ...config,
      watchlists,
      activeWatchlistName:
        config.activeWatchlistName === name
          ? watchlists[0]!.name
          : config.activeWatchlistName,
      dirty: true,
    };
  }

  public static use(config: WatchlistConfig, name: string): WatchlistConfig {
    this.get(config, name);
    return { ...config, activeWatchlistName: name, dirty: true };
  }

  private static isSame(
    a: Pick<WatchlistEntry, "kind" | "id">,
    b: Pick<WatchlistEntry, "kind" | "id">
  ): boolean {
    return a.kind === b.kind && a.id === b.id;
  }
}
