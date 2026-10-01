import chalk from "chalk";

import type { PredictionEvent } from "../clients/PredictionsClient.ts";
import { Config } from "./Config.ts";
import { NumberConverter } from "./NumberConverter.ts";
import { Output } from "./Output.ts";
import { Signer } from "./Signer.ts";

export type EventJson = ReturnType<typeof PredictionsFormat.toEventJson>;

export class PredictionsFormat {
  public static toEventJson(e: PredictionEvent) {
    return {
      eventId: e.eventId,
      title: e.metadata.title,
      category: e.category,
      isLive: e.isLive,
      volumeUsd: NumberConverter.fromMicroUsd(e.volumeUsd ?? 0),
      volume24hUsd: NumberConverter.fromMicroUsd(e.volume24hr ?? 0),
      startsAt: e.beginAt
        ? new Date(Number(e.beginAt) * 1000).toISOString()
        : null,
      endsAt: e.metadata.closeTime
        ? new Date(e.metadata.closeTime).toISOString()
        : null,
      markets: (e.markets ?? []).map((m) => ({
        marketId: m.marketId,
        title: m.title,
        status: m.status,
        provider: m.provider ?? null,
        rulesPrimary: m.rulesPrimary,
        rulesSecondary: m.rulesSecondary,
        yesPriceUsd: this.priceOrNull(m.pricing?.buyYesPriceUsd),
        noPriceUsd: this.priceOrNull(m.pricing?.buyNoPriceUsd),
        result: m.result,
      })),
    };
  }

  public static printEvents(events: EventJson[]): void {
    if (events.length === 0) {
      console.log("No events found.");
      return;
    }
    for (const event of events) {
      const startsAt = event.startsAt ? this.formatDate(event.startsAt) : "???";
      const endsAt = event.endsAt ? this.formatDate(event.endsAt) : "???";
      console.log(
        chalk.bold(event.title) + chalk.gray(` (${startsAt} — ${endsAt})`)
      );
      console.log(`Event ID: ${event.eventId}`);
      console.log(`Daily Vol: ${Output.formatDollar(event.volume24hUsd)}`);
      console.log(`Total Vol: ${Output.formatDollar(event.volumeUsd)}`);
      if (event.markets.length > 0) {
        Output.table({
          type: "horizontal",
          headers: {
            title: "Market",
            rules: "Rules",
            yes: "Yes",
            no: "No",
            marketId: "Market ID",
          },
          maxWidths: { rules: 60 },
          rows: event.markets.map((m) => ({
            title: m.title,
            rules:
              m.rulesPrimary +
              (m.rulesSecondary ? "\n\n" + chalk.gray(m.rulesSecondary) : ""),
            yes: this.formatPricePct(m.yesPriceUsd),
            no: this.formatPricePct(m.noPriceUsd),
            marketId: m.marketId,
          })),
        });
      }
      console.log();
    }
  }

  /** A zero quote means no liquidity on that side, so it is reported as null. */
  public static priceOrNull(value: number | null | undefined): number | null {
    return value ? NumberConverter.fromMicroUsd(value) : null;
  }

  public static microOrNull(
    value: string | number | null | undefined
  ): number | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    return NumberConverter.fromMicroUsd(value);
  }

  /** The API's `contracts` is truncated to whole contracts; the micro field keeps the fraction. */
  public static contracts(
    micro: string | null | undefined,
    whole: string
  ): number {
    return micro ? NumberConverter.fromMicroUsd(micro) : Number(whole);
  }

  public static formatPricePct(price: number | null): string {
    if (price === null || price === undefined) {
      return chalk.gray("—");
    }
    return `${Math.round(price * 100)}%`;
  }

  public static formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }

  public static formatDateTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  public static formatSide(side: string): string {
    const s = side.toLowerCase();
    if (s === "yes" || s === "up") {
      return chalk.green(side);
    }
    if (s === "no" || s === "down") {
      return chalk.red(side);
    }
    return side;
  }

  public static unixToIso(seconds: number | string | null): string | null {
    if (seconds === null || seconds === "" || Number(seconds) === 0) {
      return null;
    }
    return new Date(Number(seconds) * 1000).toISOString();
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

  public static parsePagination(opts: { offset: string; limit: string }): {
    start: number;
    end: number;
  } {
    const start = Number(opts.offset);
    const limit = Number(opts.limit);
    if (!Number.isInteger(start) || start < 0) {
      throw new Error("--offset must be a non-negative integer.");
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("--limit must be a positive integer.");
    }
    return { start, end: start + limit };
  }
}
