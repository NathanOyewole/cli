import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";

import { DatapiClient } from "../clients/DatapiClient.ts";
import type { DcaOrder, PriceOrder } from "../clients/TriggerClient.ts";
import { TriggerClient } from "../clients/TriggerClient.ts";
import { Config } from "../lib/Config.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { SpotDcaCommand } from "./SpotDcaCommand.ts";
import { SpotLimitCommand } from "./SpotLimitCommand.ts";

const ORDER_ID = "6f1c1c1e-0000-4000-8000-000000000001";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const priceOrder = {
  id: ORDER_ID,
  orderType: "single",
  orderState: "open",
  inputMint: USDC,
  remainingInputAmount: "25000000",
} as PriceOrder;

const dcaOrder = {
  id: ORDER_ID,
  inputMint: USDC,
  inputAmountRemaining: "30000000",
  numberOfRounds: 4,
  roundsFilled: 1,
  displayState: "active",
} as DcaOrder;

async function run(args: string[]): Promise<unknown> {
  const program = new Command().exitOverride();
  const spot = program.command("spot");
  SpotLimitCommand.register(spot);
  SpotDcaCommand.register(spot);
  const logs: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => {
    logs.push(line);
  });
  try {
    await program.parseAsync(["spot", ...args], { from: "user" });
  } finally {
    log.mockRestore();
  }
  return JSON.parse(logs.join("\n"));
}

describe("order close --dry-run", () => {
  const spies: { mockRestore(): void }[] = [];
  let cancel: ReturnType<typeof spyOn>;
  let confirm: ReturnType<typeof spyOn>;
  const nonGetRequests: string[] = [];

  beforeEach(async () => {
    Config.dryRun = true;
    Output.outputOverride = "json";
    nonGetRequests.length = 0;
    const signer = await Signer.generate();
    cancel = spyOn(TriggerClient, "cancelOrder");
    confirm = spyOn(TriggerClient, "confirmCancelOrder");
    spies.push(
      cancel,
      confirm,
      spyOn(Signer, "load").mockResolvedValue(signer),
      spyOn(TriggerClient, "getPriceOrder").mockResolvedValue(priceOrder),
      spyOn(TriggerClient, "getDcaOrder").mockResolvedValue(dcaOrder),
      spyOn(DatapiClient, "getTokensByMints").mockResolvedValue([]),
      spyOn(globalThis, "fetch").mockImplementation((async (
        input: string | URL | Request,
        init?: RequestInit
      ) => {
        const request =
          input instanceof Request
            ? input
            : new Request(input.toString(), init);
        if (request.method !== "GET") {
          nonGetRequests.push(`${request.method} ${request.url}`);
        }
        throw new Error(`Unexpected network call: ${request.url}`);
      }) as unknown as typeof fetch)
    );
  });

  afterEach(() => {
    Config.dryRun = false;
    Output.outputOverride = undefined;
    spies.splice(0).forEach((s) => s.mockRestore());
  });

  test("limit close never starts the cancel", async () => {
    const json = await run([
      "limit",
      "close",
      "--order",
      ORDER_ID,
      "--key",
      "test",
    ]);
    expect(cancel).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(nonGetRequests).toEqual([]);
    expect(json).toEqual({
      dryRun: true,
      orderId: ORDER_ID,
      state: "open",
      inputToken: { id: USDC, symbol: null, decimals: null },
      remainingInAmount: "25000000",
      signature: null,
      transaction: null,
    });
  });

  test("dca close never starts the cancel", async () => {
    const json = await run([
      "dca",
      "close",
      "--order",
      ORDER_ID,
      "--key",
      "test",
    ]);
    expect(cancel).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(nonGetRequests).toEqual([]);
    expect(json).toEqual({
      dryRun: true,
      orderId: ORDER_ID,
      state: "active",
      inputToken: { id: USDC, symbol: null, decimals: null },
      remainingInAmount: "30000000",
      ordersRemaining: 3,
      signature: null,
      transaction: null,
    });
  });
});
