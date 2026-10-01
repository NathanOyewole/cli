import { isAddress } from "@solana/kit";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Config } from "./Config.ts";

export type AddressBookWallet = { name: string; address: string };
export type AddressBookGroup = { name: string; addresses: string[] };
export type AddressBookData = {
  wallets: AddressBookWallet[];
  groups: AddressBookGroup[];
};

// Mirrors the demo wallets on jup.ag/portfolio. They are read-only built-ins
// so `--address demo` opens the same group the web's "View all 3" link does.
export const DEMO_WALLETS: readonly AddressBookWallet[] = [
  {
    name: "defi-whale",
    address: "DemoSX9F2zXfQLtBr56Yr5he15P7viZWsYJpSDAX3tKG",
  },
  {
    name: "jup-staker",
    address: "jupE53639uCTuXk3VgRmUuDoafR9baGfLZf4T5DBH5H",
  },
  {
    name: "airdrop-farmer",
    address: "tEsT1vjsJeKHw9GH5HpnQszn2LWmjR6q1AVCDCj51nd",
  },
];
export const DEMO_GROUP: AddressBookGroup = {
  name: "demo",
  addresses: DEMO_WALLETS.map((w) => w.address),
};

// Same cap as the web's wallet groups (BUNDLE_MAX_SIZE).
export const MAX_GROUP_SIZE = 15;

export class AddressBook {
  public static readonly FILE = join(Config.CONFIG_DIR, "addressbook.json");

  public static load(): AddressBookData {
    if (!existsSync(this.FILE)) {
      return { wallets: [], groups: [] };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.FILE, "utf-8"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Could not parse ${this.FILE}: ${message}. Fix the file or remove it.`
      );
    }
    const o = (raw ?? {}) as Partial<AddressBookData>;
    return {
      wallets: Array.isArray(o.wallets) ? o.wallets : [],
      groups: Array.isArray(o.groups) ? o.groups : [],
    };
  }

  public static save(data: AddressBookData): void {
    writeFileSync(this.FILE, JSON.stringify(data, null, 2) + "\n");
  }

  public static addWallet(
    data: AddressBookData,
    name: string,
    address: string,
    group?: string
  ): AddressBookData {
    this.validateName(name);
    if (!isAddress(address)) {
      throw new Error(`Invalid Solana address: ${address}`);
    }
    const existing = data.wallets.find((w) => w.name === name);
    if (existing && existing.address !== address) {
      throw new Error(
        `"${name}" already refers to ${existing.address}. Remove it first or pick another name.`
      );
    }
    if (data.groups.some((g) => g.name === name)) {
      throw new Error(`"${name}" is already a group name.`);
    }
    const wallets = existing
      ? data.wallets
      : [...data.wallets, { name, address }];
    if (!group) {
      return { wallets, groups: data.groups };
    }
    if (group === name || wallets.some((w) => w.name === group)) {
      throw new Error(`"${group}" is already a wallet name.`);
    }
    this.validateName(group);
    const target = data.groups.find((g) => g.name === group);
    if (target?.addresses.includes(address)) {
      return { wallets, groups: data.groups };
    }
    if (target && target.addresses.length >= MAX_GROUP_SIZE) {
      throw new Error(
        `Group "${group}" already has ${MAX_GROUP_SIZE} wallets, the maximum.`
      );
    }
    const groups = target
      ? data.groups.map((g) =>
          g === target ? { ...g, addresses: [...g.addresses, address] } : g
        )
      : [...data.groups, { name: group, addresses: [address] }];
    return { wallets, groups };
  }

  public static remove(
    data: AddressBookData,
    name: string,
    group?: string
  ): AddressBookData {
    if (group) {
      const target = data.groups.find((g) => g.name === group);
      if (!target) {
        throw new Error(`No group named "${group}".`);
      }
      const address =
        data.wallets.find((w) => w.name === name)?.address ?? name;
      if (!target.addresses.includes(address)) {
        throw new Error(`"${name}" is not in group "${group}".`);
      }
      return {
        wallets: data.wallets,
        groups: data.groups
          .map((g) =>
            g === target
              ? { ...g, addresses: g.addresses.filter((a) => a !== address) }
              : g
          )
          .filter((g) => g.addresses.length > 0),
      };
    }

    const wallet = data.wallets.find((w) => w.name === name);
    if (wallet) {
      return {
        wallets: data.wallets.filter((w) => w !== wallet),
        groups: data.groups
          .map((g) => ({
            ...g,
            addresses: g.addresses.filter((a) => a !== wallet.address),
          }))
          .filter((g) => g.addresses.length > 0),
      };
    }
    if (data.groups.some((g) => g.name === name)) {
      return {
        wallets: data.wallets,
        groups: data.groups.filter((g) => g.name !== name),
      };
    }
    throw new Error(`No wallet or group named "${name}".`);
  }

  /**
   * Resolves a comma-separated list of addresses, saved wallet names and group
   * names (including the built-in demo wallets) into unique addresses.
   */
  public static resolve(input: string, data: AddressBookData): string[] {
    const wallets = [...DEMO_WALLETS, ...data.wallets];
    const groups = [DEMO_GROUP, ...data.groups];
    const resolved: string[] = [];
    for (const part of input.split(",").map((p) => p.trim())) {
      if (!part) {
        continue;
      }
      const wallet = wallets.find((w) => w.name === part);
      const addresses = isAddress(part)
        ? [part]
        : wallet
          ? [wallet.address]
          : groups.find((g) => g.name === part)?.addresses;
      if (!addresses) {
        throw new Error(
          `"${part}" is not a valid Solana address or address book name.`
        );
      }
      resolved.push(...addresses);
    }
    const unique = [...new Set(resolved)];
    if (unique.length === 0) {
      throw new Error("No address provided.");
    }
    if (unique.length > MAX_GROUP_SIZE) {
      throw new Error(
        `At most ${MAX_GROUP_SIZE} wallets can be viewed together.`
      );
    }
    return unique;
  }

  private static validateName(name: string): void {
    if (!/^[\w.-]+$/.test(name)) {
      throw new Error(
        `Invalid name "${name}": use letters, digits, ".", "_" or "-".`
      );
    }
    if (isAddress(name)) {
      throw new Error("A name cannot be a Solana address.");
    }
    if (name === DEMO_GROUP.name || DEMO_WALLETS.some((w) => w.name === name)) {
      throw new Error(`"${name}" is a built-in demo name.`);
    }
  }
}
