import type { Command } from "commander";

import { DepositClient, type BridgeToken } from "../clients/DepositClient.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { Swap } from "../lib/Swap.ts";

// Chain keys accepted by jup.ag/deposit/bridge (src/api/universal-bridge/chains.ts).
export const BRIDGE_CHAINS = [
  "solana",
  "ethereum",
  "base",
  "arbitrum",
  "sui",
  "bnb",
  "robinhood",
  "optimism",
  "polygon",
  "avalanche",
  "linea",
] as const;

export class DepositCommand {
  public static register(program: Command): void {
    const deposit = program
      .command("deposit")
      .description("Receive funds: deposit addresses, onramp and bridging");
    deposit
      .command("receive")
      .description(
        "Show your Solana address and the addresses on other chains that auto-deliver to it"
      )
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Solana wallet address to receive to")
      .action((opts) => this.receive(opts));
    deposit
      .command("onramp")
      .description("Get a link to buy SOL with fiat into your wallet")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Solana wallet address to receive to")
      .action((opts) => this.onramp(opts));
    deposit
      .command("bridge-tokens")
      .description("List tokens bridgeable on a chain")
      .requiredOption("--chain <chain>", `One of: ${BRIDGE_CHAINS.join(", ")}`)
      .option("--search <query>", "Token symbol, name or address")
      .option("--limit <n>", "Max number of results", "20")
      .action((opts) => this.bridgeTokens(opts));
    deposit
      .command("bridge-quote")
      .description("Compare cross-chain bridge quotes (Universal, deBridge)")
      .requiredOption("--from-chain <chain>", "Origin chain")
      .requiredOption("--from-token <token>", "Origin token symbol or address")
      .option("--to-chain <chain>", "Destination chain", "solana")
      .requiredOption(
        "--to-token <token>",
        "Destination token symbol or address"
      )
      .option("--amount <n>", "Amount in human-readable units")
      .option("--raw-amount <n>", "Amount in on-chain units")
      .action((opts) => this.bridgeQuote(opts));
  }

  private static async resolveAddress(opts: {
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

  private static async receive(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await this.resolveAddress(opts);
    const { chains } = await DepositClient.getDepositAddresses(address);
    const UNAVAILABLE = 2;
    const available = chains.filter(
      (c) => c.status.code !== UNAVAILABLE && c.depositAddress?.trim()
    );
    const depositAddresses = available.map((c) => ({
      chain: c.chainName,
      chainId: c.chainId,
      depositAddress: c.depositAddress,
      token: c.tokenAddress,
      minDeposit: c.minDeposit,
      feeUsd: c.feesUsd,
      status: c.status.name,
    }));

    if (Output.isJson()) {
      Output.json({ address, depositAddresses });
      return;
    }
    Output.table({
      type: "vertical",
      rows: [{ label: "Solana Address", value: address }],
    });
    console.log(
      "\nSend from another chain to these addresses to auto-deliver to your Solana wallet:"
    );
    Output.table({
      type: "horizontal",
      headers: {
        chain: "Chain",
        depositAddress: "Deposit Address",
        token: "Token",
        minDeposit: "Min Deposit",
        fee: "Fee",
        status: "Status",
      },
      rows: depositAddresses.map((d) => ({
        ...d,
        fee: Output.formatDollar(d.feeUsd, { decimals: 2 }),
      })),
    });
  }

  private static async onramp(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await this.resolveAddress(opts);
    const { url } = await DepositClient.getOnrampUrl(address);
    if (Output.isJson()) {
      Output.json({ address, url });
      return;
    }
    console.log(`Open this link to buy SOL into ${address}:\n\n${url}`);
  }

  private static async bridgeTokens(opts: {
    chain: string;
    search?: string;
    limit: string;
  }): Promise<void> {
    const chain = this.validateChain(opts.chain);
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("--limit must be a positive integer.");
    }
    const { tokens } = await DepositClient.getBridgeTokens(chain, opts.search);
    const result = tokens.slice(0, limit).map((t) => ({
      chain: t.chainKey,
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      isNative: t.isNative,
    }));

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        symbol: "Symbol",
        name: "Name",
        address: "Address",
        decimals: "Decimals",
      },
      rows: result,
    });
  }

  private static async bridgeQuote(opts: {
    fromChain: string;
    fromToken: string;
    toChain: string;
    toToken: string;
    amount?: string;
    rawAmount?: string;
  }): Promise<void> {
    Swap.validateAmountOpts(opts);
    const fromChain = this.validateChain(opts.fromChain);
    const toChain = this.validateChain(opts.toChain);
    if (fromChain === toChain) {
      throw new Error("--from-chain and --to-chain must differ.");
    }
    const [input, output] = await Promise.all([
      this.resolveBridgeToken(fromChain, opts.fromToken),
      this.resolveBridgeToken(toChain, opts.toToken),
    ]);
    const rawAmount =
      opts.rawAmount ??
      NumberConverter.toChainAmount(opts.amount!, input.decimals);
    const quote = await DepositClient.getBridgeQuote({
      input,
      output,
      rawAmount,
    });
    const routes = quote.routes
      .map((r) => ({
        provider: r.provider,
        outAmount: NumberConverter.fromChainAmount(
          r.outAmount,
          output.decimals
        ),
      }))
      .sort((a, b) => Number(b.outAmount) - Number(a.outAmount));
    const tokenRef = (t: BridgeToken) => ({
      chain: t.chainKey,
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
    });
    const result = {
      inputToken: tokenRef(input),
      outputToken: tokenRef(output),
      inAmount: NumberConverter.fromChainAmount(rawAmount, input.decimals),
      routes,
      failures: quote.failures,
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    if (routes.length === 0) {
      throw new Error(
        `No bridge route: ${quote.failures.map((f) => `${f.provider} ${f.reason}`).join(", ") || "unavailable"}`
      );
    }
    console.log(
      `${result.inAmount} ${input.symbol} (${fromChain}) -> ${output.symbol} (${toChain})`
    );
    Output.table({
      type: "horizontal",
      headers: { provider: "Provider", outAmount: "You Receive" },
      rows: routes.map((r) => ({
        provider: r.provider,
        outAmount: `${r.outAmount} ${output.symbol}`,
      })),
    });
    console.log(
      "\nBridging executes in the provider's widget at https://jup.ag/deposit/bridge."
    );
  }

  private static validateChain(chain: string): string {
    const key = chain.toLowerCase();
    if (!(BRIDGE_CHAINS as readonly string[]).includes(key)) {
      throw new Error(
        `Unknown chain "${chain}". Use one of: ${BRIDGE_CHAINS.join(", ")}.`
      );
    }
    return key;
  }

  private static async resolveBridgeToken(
    chain: string,
    input: string
  ): Promise<BridgeToken> {
    const { tokens } = await DepositClient.getBridgeTokens(chain, input);
    const query = input.toLowerCase();
    const match =
      tokens.find((t) => t.address.toLowerCase() === query) ??
      tokens.find((t) => t.symbol.toLowerCase() === query);
    if (!match) {
      throw new Error(`Token "${input}" not found on ${chain}.`);
    }
    return match;
  }
}
