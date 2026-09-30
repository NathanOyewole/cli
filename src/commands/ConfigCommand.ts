import type { Command } from "commander";

import { Config } from "../lib/Config.ts";
import { Output } from "../lib/Output.ts";

export class ConfigCommand {
  public static register(program: Command): void {
    const config = program
      .command("config")
      .description("CLI settings and configurations");
    config
      .command("list")
      .description("List all settings")
      .action(() => this.list());
    config
      .command("set")
      .description("Update settings")
      .option("--active-key <name>", "Set the active key")
      .option("--output <type>", "Set the output format ('table' or 'json')")
      .option(
        "--api-key [key]",
        "Use an API key from https://portal.jup.ag/ for higher rate limits"
      )
      .option(
        "--rpc-url [url]",
        "Solana RPC used by commands that send transactions directly (default: public mainnet RPC)"
      )
      .action((opts) => this.set(opts));
  }

  private static list(): void {
    const settings = Config.load();
    if (Output.isJson()) {
      Output.json(this.redactForDisplay(settings));
      return;
    }

    const display = this.redactForDisplay(settings);
    const data = Object.entries(display).map(([key, value]) => ({
      setting: key,
      value: value != null && value !== "" ? String(value) : "",
    }));
    Output.table({
      type: "horizontal",
      headers: { setting: "Setting", value: "Value" },
      rows: data,
    });
  }

  private static redactForDisplay(
    settings: ReturnType<typeof Config.load>
  ): ReturnType<typeof Config.load> {
    if (!settings.apiKey) {
      return settings;
    }
    return { ...settings, apiKey: "<set>" };
  }

  private static set(opts: {
    activeKey?: string;
    output?: "table" | "json";
    apiKey?: string | true;
    rpcUrl?: string | true;
  }): void {
    if (opts.output && opts.output !== "table" && opts.output !== "json") {
      throw new Error("Invalid --output format. Must be 'table' or 'json'.");
    }
    // A valueless --api-key or --rpc-url (Commander passes `true`) clears it
    const { apiKey, rpcUrl, ...rest } = opts;
    Config.set({
      ...rest,
      ...(apiKey !== undefined && {
        apiKey: typeof apiKey === "string" ? apiKey : undefined,
      }),
      ...(rpcUrl !== undefined && {
        rpcUrl: typeof rpcUrl === "string" ? rpcUrl : undefined,
      }),
    });
    this.list();
  }
}
