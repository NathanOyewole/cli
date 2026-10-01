import { describe, expect, test } from "bun:test";
import { Command } from "commander";

import { TokenFilters } from "./TokenFilters.ts";

function parse(args: string[]): Record<string, unknown> {
  const cmd = TokenFilters.addOptions(
    new Command().exitOverride().configureOutput({ writeErr: () => {} })
  );
  cmd.parse(args, { from: "user" });
  return cmd.opts();
}

describe("TokenFilters", () => {
  test("maps CLI flags to datapi filter keys", () => {
    const opts = parse([
      "--verified",
      "--small-meteora-dbc",
      "--min-mcap",
      "100000",
      "--max-dev-balance-pct",
      "5",
      "--launchpad",
      "pump.fun, met-dbc",
    ]);
    expect(TokenFilters.fromOptions(opts)).toEqual({
      verified: true,
      smallMeteoraDBC: true,
      minMcap: 100000,
      maxDevBalancePct: 5,
      launchpads: ["pump.fun", "met-dbc"],
    });
  });

  test("suffixes interval-scoped filters with the interval", () => {
    const resolved = TokenFilters.resolve(
      { minVolume: 1000, maxTxns: 50, minMcap: 10 },
      "1h"
    );
    expect(resolved).toEqual({ minVolume1h: 1000, maxTxns1h: 50, minMcap: 10 });
  });

  test("comma-joins lists for query strings", () => {
    expect(
      TokenFilters.toSearchParams({
        launchpads: ["pump.fun", "bags.fun"],
        onlyStable: true,
        minLiquidity: 5,
      })
    ).toEqual({
      launchpads: "pump.fun,bags.fun",
      onlyStable: true,
      minLiquidity: 5,
    });
  });

  test("rejects non-numeric values and too many keywords", () => {
    expect(() => parse(["--min-mcap", "lots"])).toThrow();
    expect(() => parse(["--search-include", "a,b,c,d,e,f"])).toThrow();
  });
});
