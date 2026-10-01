import {
  address,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from "@solana/kit";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Command } from "commander";

import { GachaClient, type Machine } from "../clients/GachaClient.ts";
import { Config } from "../lib/Config.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { GachaCommand } from "./GachaCommand.ts";

const machine = { code: "pokemon_50", name: "Pokemon", priceNumber: 50 };

function unsignedTransaction(feePayer: string): string {
  return getBase64EncodedWireTransaction(
    compileTransaction(
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: "11111111111111111111111111111111" as Blockhash,
          lastValidBlockHeight: 1n,
        },
        setTransactionMessageFeePayer(
          address(feePayer),
          createTransactionMessage({ version: 0 })
        )
      )
    )
  );
}

async function run(args: string[]): Promise<unknown> {
  const program = new Command().exitOverride();
  GachaCommand.register(program);
  const logs: string[] = [];
  const log = spyOn(console, "log").mockImplementation((line: string) => {
    logs.push(line);
  });
  try {
    await program.parseAsync(["gacha", ...args], { from: "user" });
  } finally {
    log.mockRestore();
  }
  return JSON.parse(logs.join("\n"));
}

describe("gacha open --quantity", () => {
  const spies: { mockRestore(): void }[] = [];
  const events: string[] = [];
  let generated = 0;

  beforeEach(async () => {
    Output.outputOverride = "json";
    events.length = 0;
    generated = 0;
    const signer = await Signer.generate();
    spies.push(
      spyOn(Signer, "load").mockResolvedValue(signer),
      spyOn(GachaClient, "getMachines").mockResolvedValue([machine as Machine]),
      spyOn(GachaClient, "generatePack").mockImplementation(async () => {
        generated++;
        events.push(`generate m${generated}`);
        return {
          memo: `m${generated}`,
          transaction: unsignedTransaction(signer.address),
        };
      }),
      spyOn(GachaClient, "submitPack").mockImplementation(async () => {
        events.push(`submit m${generated}`);
        return { signature: `sig${generated}` };
      }),
      spyOn(GachaClient, "openPack").mockImplementation(async (memo) => {
        events.push(`open ${memo}`);
        if (memo === "m2") {
          throw new Error("Request timed out.");
        }
        return { result: { type: "turbo-mode-buyback", amount: "12" } };
      })
    );
  });

  afterEach(() => {
    Output.outputOverride = undefined;
    process.exitCode = 0;
    spies.splice(0).forEach((s) => s.mockRestore());
  });

  test("builds each pack just before submitting it and stops at the first failure", async () => {
    const json = await run([
      "open",
      "--pack",
      "pokemon_50",
      "--quantity",
      "3",
      "--key",
      "test",
    ]);

    expect(events).toEqual([
      "generate m1",
      "submit m1",
      "open m1",
      "generate m2",
      "submit m2",
      "open m2",
    ]);
    expect(json).toEqual({
      pack: "pokemon_50",
      address: expect.any(String),
      pulls: [
        {
          memo: "m1",
          result: "buyback",
          card: null,
          buybackUsd: 12,
          signature: "sig1",
        },
      ],
      failed: {
        stage: "open",
        memo: "m2",
        signature: "sig2",
        error: "Request timed out.",
        retry: "jup gacha open --pack pokemon_50 --memo m2",
        packsNotOpened: 1,
      },
    });
    expect(process.exitCode).toBe(1);
  });

  test("rejects --quantity with --memo", async () => {
    await expect(
      run(["open", "--pack", "pokemon_50", "--memo", "m1", "--quantity", "2"])
    ).rejects.toThrow("--quantity cannot be combined with --memo.");
  });

  test("dry run still builds every pack up front", async () => {
    Config.dryRun = true;
    try {
      const json = (await run([
        "open",
        "--pack",
        "pokemon_50",
        "--quantity",
        "2",
        "--key",
        "test",
      ])) as { memos: string[] };
      expect(json.memos).toEqual(["m1", "m2"]);
      expect(events).toEqual(["generate m1", "generate m2"]);
    } finally {
      Config.dryRun = false;
    }
  });
});
