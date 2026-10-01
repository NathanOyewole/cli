import { isAddress } from "@solana/kit";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Config } from "./Config.ts";

// `following` and `labels` mirror the jup.ag web app's
// `pro_wallet_tracker_config.following` / `.labels` localStorage values.
export type FollowedWallet = {
  address: string;
  addedAt: string;
  sound?: string | undefined;
  toast?: boolean | undefined;
};

export type WalletLabel = {
  address: string;
  name: string;
  emoji?: string | undefined;
  groups?: string[] | undefined;
};

export type TrackerConfig = {
  following: FollowedWallet[];
  labels: WalletLabel[];
};

export type TrackedWallet = FollowedWallet & Omit<WalletLabel, "address">;

// Axiom-compatible share format used by the web app's import/export dialog.
export type SharedWallet = {
  address: string;
  name: string;
  emoji: string | undefined;
  alertsOnToast: boolean;
  alertsOnBubble: boolean;
  alertsOnFeed: boolean;
  groups: string[];
  sound: string | undefined;
};

const APP_SOUNDS = [
  "off",
  "default",
  "ka-ching",
  "bell",
  "pop",
  "coins",
  "ring",
];
const SOUND_ALIASES: Record<string, string> = {
  kaching: "ka-ching",
  none: "off",
};
const DEFAULT_SOUND = "bell";
const EMOJI_REGEX = /\p{Emoji_Presentation}/u;

export class WalletTracker {
  public static readonly FILE = join(Config.CONFIG_DIR, "tracker.json");
  public static readonly MAX_WALLETS = 50;
  public static readonly MAX_NAME_LENGTH = 18;

  public static load(): TrackerConfig {
    if (!existsSync(this.FILE)) {
      return { following: [], labels: [] };
    }
    try {
      const raw = JSON.parse(
        readFileSync(this.FILE, "utf-8")
      ) as Partial<TrackerConfig> | null;
      return {
        following: Array.isArray(raw?.following) ? raw.following : [],
        labels: Array.isArray(raw?.labels) ? raw.labels : [],
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not read ${this.FILE}: ${message}. Fix the file or remove it to reset the tracker.`
      );
    }
  }

  public static save(config: TrackerConfig): void {
    writeFileSync(this.FILE, JSON.stringify(config, null, 2) + "\n");
  }

  public static wallets(config: TrackerConfig): TrackedWallet[] {
    const labels = new Map(config.labels.map((l) => [l.address, l]));
    return config.following.map((w) => {
      const label = labels.get(w.address);
      return {
        ...w,
        name: label?.name ?? "",
        emoji: label?.emoji,
        groups: label?.groups,
      };
    });
  }

  public static follow(
    config: TrackerConfig,
    wallet: Omit<TrackedWallet, "addedAt" | "name"> & {
      name?: string | undefined;
    },
    now: Date
  ): TrackerConfig {
    if (!isAddress(wallet.address)) {
      throw new Error(`Invalid wallet address: ${wallet.address}`);
    }
    if (wallet.name && wallet.name.length > this.MAX_NAME_LENGTH) {
      throw new Error(
        `Wallet names can be at most ${this.MAX_NAME_LENGTH} characters.`
      );
    }
    const isFollowing = config.following.some(
      (w) => w.address === wallet.address
    );
    if (!isFollowing && config.following.length >= this.MAX_WALLETS) {
      throw new Error(`You can follow at most ${this.MAX_WALLETS} wallets.`);
    }
    const existing = config.labels.find((l) => l.address === wallet.address);
    return {
      following: isFollowing
        ? config.following
        : [
            ...config.following,
            { address: wallet.address, addedAt: now.toISOString() },
          ],
      labels: this.setLabel(config.labels, {
        address: wallet.address,
        name: wallet.name ?? existing?.name ?? "",
        emoji: wallet.emoji ?? existing?.emoji,
        groups: wallet.groups ?? existing?.groups,
      }),
    };
  }

  public static unfollow(
    config: TrackerConfig,
    address: string
  ): { config: TrackerConfig; removed: boolean } {
    const following = config.following.filter((w) => w.address !== address);
    return {
      config: { ...config, following },
      removed: following.length !== config.following.length,
    };
  }

  public static toShared(config: TrackerConfig): SharedWallet[] {
    return this.wallets(config).map((w) => ({
      address: w.address,
      name: w.name,
      emoji: w.emoji,
      alertsOnToast: w.toast !== false,
      alertsOnBubble: true,
      alertsOnFeed: true,
      groups: w.groups ?? [],
      sound: w.sound?.toLowerCase(),
    }));
  }

  // Accepts the web app's share JSON, Axiom, GMGN and Padre exports.
  public static parseShared(
    raw: unknown,
    now: Date
  ): { wallets: TrackedWallet[]; skipped: number } {
    if (!Array.isArray(raw)) {
      throw new Error("Expected a JSON array of wallets.");
    }
    const wallets: TrackedWallet[] = [];
    for (const item of raw as Record<string, unknown>[]) {
      const address = item?.address ?? item?.trackedWalletAddress;
      if (typeof address !== "string" || !isAddress(address)) {
        continue;
      }
      const emoji =
        typeof item.emoji === "string"
          ? item.emoji.trim().match(EMOJI_REGEX)?.[0]
          : undefined;
      const rawGroups = item.groups ?? item.groupNames ?? item.group;
      wallets.push({
        address,
        addedAt:
          typeof item.addedAt === "string" ? item.addedAt : now.toISOString(),
        name:
          typeof item.name === "string"
            ? item.name.trim().slice(0, this.MAX_NAME_LENGTH)
            : "",
        emoji: emoji === "👻" ? undefined : emoji,
        groups: Array.isArray(rawGroups)
          ? rawGroups.map((g) => (g === "Default" ? "Main" : String(g)))
          : undefined,
        sound: this.normalizeSound(item.sound),
        toast: !!item.alertsOn || !!item.alertsOnToast || item.toast === true,
      });
    }
    return { wallets, skipped: raw.length - wallets.length };
  }

  public static merge(
    config: TrackerConfig,
    imported: TrackedWallet[]
  ): TrackerConfig {
    const byAddress = new Map(config.following.map((w) => [w.address, w]));
    let labels = config.labels;
    for (const w of imported) {
      if (!byAddress.has(w.address)) {
        byAddress.set(w.address, {
          address: w.address,
          addedAt: w.addedAt,
          ...(w.sound && { sound: w.sound }),
          ...(w.toast !== undefined && { toast: w.toast }),
        });
      }
      labels = this.setLabel(labels, w);
    }
    const following = [...byAddress.values()]
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
      .slice(0, this.MAX_WALLETS)
      .reverse();
    return { following, labels };
  }

  private static setLabel(
    labels: WalletLabel[],
    label: WalletLabel
  ): WalletLabel[] {
    const others = labels.filter((l) => l.address !== label.address);
    const next: WalletLabel = {
      address: label.address,
      name: label.name,
      ...(label.emoji && { emoji: label.emoji }),
      ...(label.groups?.length && { groups: label.groups }),
    };
    const meaningful =
      next.name.trim().length > 0 || next.emoji || next.groups?.length;
    return meaningful ? [...others, next] : others;
  }

  private static normalizeSound(sound: unknown): string | undefined {
    if (typeof sound !== "string" || !sound) {
      return undefined;
    }
    const normalized =
      SOUND_ALIASES[sound.toLowerCase()] ?? sound.toLowerCase();
    return APP_SOUNDS.includes(normalized) ? normalized : DEFAULT_SOUND;
  }
}
