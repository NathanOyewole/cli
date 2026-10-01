import { Option } from "commander";

import { LEND_MARKETS } from "../clients/LendClient.ts";
import { Config } from "./Config.ts";
import { Signer } from "./Signer.ts";

export class LendOptions {
  public static market(): Option {
    return new Option("--market <market>", "Lend market")
      .choices(LEND_MARKETS)
      .default("main");
  }

  public static async resolveAddress(opts: {
    key?: string;
    address?: string;
  }): Promise<string> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    return (
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey))
    );
  }

  public static positiveInt(name: string, value: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`${name} must be a non-negative integer.`);
    }
    return n;
  }
}
