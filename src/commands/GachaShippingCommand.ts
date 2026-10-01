import {
  getBase58Decoder,
  isAddress,
  type Base64EncodedBytes,
} from "@solana/kit";
import chalk from "chalk";
import type { Command } from "commander";

import { GachaClient, type Shipment } from "../clients/GachaClient.ts";
import { Config } from "../lib/Config.ts";
import { Gacha } from "../lib/Gacha.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";

// Collector Crypt only issues shipping sessions for domains on Jupiter's
// partner allowlist, so the sign-in message names jup.ag like the web app.
const SIWS_DOMAIN = "jup.ag";

export class GachaShippingCommand {
  public static register(gacha: Command): void {
    gacha
      .command("shipping")
      .description(
        "View shipping addresses and shipments (signs a Collector Crypt sign-in message)"
      )
      .option("--shipment <id>", "Look up a single shipment")
      .option("--key <name>", "Key to use for signing in")
      .action((opts) => this.shipping(opts));
    gacha
      .command("ship")
      .description("Redeem cards for physical delivery")
      .requiredOption("--mint <mints...>", "Card mint addresses to ship")
      .requiredOption(
        "--address-id <id>",
        "Shipping address ID from `jup gacha shipping`"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.ship(opts));
  }

  private static async signIn(signer: Signer): Promise<string> {
    const { message } = await GachaClient.getShippingNonce({
      wallet: signer.address,
      partnerAppId: "jupiter",
      domain: SIWS_DOMAIN,
      uri: `https://${SIWS_DOMAIN}`,
    });
    const signature = await signer.signMessage(message);
    const { accessToken } = await GachaClient.verifyShippingSignIn({
      message,
      signature: getBase58Decoder().decode(signature),
    });
    return accessToken;
  }

  private static shipmentSummary(s: Shipment) {
    return {
      id: s.id,
      reference: s.customId ?? null,
      status: s.status ?? null,
      cardCount: s.numberOfCards ?? null,
      carrier: s.deliveryCompany ?? null,
      trackingIds: s.trackingIds ?? [],
      trackingUrls: s.trackingUrls ?? [],
      totalCostUsd:
        s.totalCost !== undefined && s.totalCost !== null
          ? Number(s.totalCost)
          : null,
      createdAt: s.createdAt ?? null,
    };
  }

  private static async shipping(opts: {
    shipment?: string;
    key?: string;
  }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const token = await this.signIn(signer);

    if (opts.shipment) {
      const shipment = this.shipmentSummary(
        await GachaClient.getShipment(opts.shipment, token)
      );
      if (Output.isJson()) {
        Output.json({ shipment });
        return;
      }
      Output.table({
        type: "vertical",
        rows: Object.entries(shipment).map(([label, value]) => ({
          label,
          value: Array.isArray(value)
            ? value.join("\n") || "—"
            : String(value ?? "—"),
        })),
      });
      return;
    }

    const [addresses, rawShipments] = await Promise.all([
      GachaClient.getShippingAddresses(token),
      GachaClient.getShipments(token),
    ]);
    const shipments = Gacha.coerceList<Shipment>(rawShipments).map((s) =>
      this.shipmentSummary(s)
    );
    const addressRows = addresses.map((a) => ({
      id: a.id,
      name: a.fullName ?? null,
      city: a.city ?? null,
      state: a.state ?? null,
      country: a.country ?? null,
      isDefault: a.isDefault ?? false,
    }));

    if (Output.isJson()) {
      Output.json({
        address: signer.address,
        addresses: addressRows,
        shipments,
      });
      return;
    }
    console.log(chalk.bold("Shipping addresses"));
    Output.table({
      type: "horizontal",
      headers: {
        id: "ID",
        name: "Name",
        city: "City",
        country: "Country",
        isDefault: "Default",
      },
      rows: addressRows.map((a) => ({
        ...a,
        isDefault: Output.formatBoolean(a.isDefault),
      })),
    });
    console.log(chalk.bold("Shipments"));
    Output.table({
      type: "horizontal",
      headers: {
        id: "ID",
        status: "Status",
        cardCount: "Cards",
        carrier: "Carrier",
        tracking: "Tracking",
      },
      rows: shipments.map((s) => ({
        ...s,
        tracking: s.trackingIds.join(", "),
      })),
    });
  }

  private static async ship(opts: {
    mint: string[];
    addressId: string;
    key?: string;
  }): Promise<void> {
    const mints = [...new Set(opts.mint)];
    if (!mints.every((m) => isAddress(m))) {
      throw new Error("Invalid --mint.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const token = await this.signIn(signer);
    const estimate = await GachaClient.estimateShipping(
      { nftAddresses: mints, shippingAddressId: opts.addressId },
      token
    );
    const quote = {
      cardCount: estimate.numberOfCards ?? mints.length,
      shippingUsd: estimate.shippingPrice ?? null,
      insuranceUsd: estimate.insurancePrice ?? null,
      feesUsd: estimate.feesPrice ?? null,
      totalUsd: estimate.total ?? null,
    };

    // Preparing a redemption opens a shipment order with Collector Crypt, so a
    // dry run stops at the quote.
    if (Config.dryRun) {
      if (Output.isJson()) {
        Output.json({
          dryRun: true,
          mints,
          addressId: opts.addressId,
          ...quote,
          shipmentId: null,
          signature: null,
        });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      this.printQuote(mints, quote);
      return;
    }

    const prepared = await GachaClient.prepareShipping(
      { nftAddresses: mints, shippingAddressId: opts.addressId },
      token
    );
    // A prepared shipment is an open order with Collector Crypt; its ID is what
    // support needs if anything after this point fails.
    const shipmentId = prepared.outboundShipmentId;
    let res: { id: string; status?: string };
    try {
      if (!prepared.transactions?.length) {
        throw new Error("No transactions to sign.");
      }
      const signed = [];
      for (const tx of prepared.transactions) {
        signed.push(await signer.signTransaction(tx as Base64EncodedBytes));
      }
      res = await GachaClient.submitShipping(shipmentId, signed, token);
    } catch (err) {
      throw new Error(
        `${await Output.errorMessage(err)} (shipment ${shipmentId})`
      );
    }

    if (Output.isJson()) {
      Output.json({
        mints,
        addressId: opts.addressId,
        ...quote,
        totalUsd: prepared.totalCost ?? quote.totalUsd,
        shipmentId: res.id ?? shipmentId,
        status: res.status ?? null,
      });
      return;
    }
    this.printQuote(mints, quote);
    console.log(
      `Shipment ${res.id ?? shipmentId}: ${res.status ?? "submitted"}`
    );
  }

  private static printQuote(
    mints: string[],
    quote: {
      shippingUsd: number | null;
      insuranceUsd: number | null;
      feesUsd: number | null;
      totalUsd: number | null;
    }
  ): void {
    Output.table({
      type: "vertical",
      rows: [
        { label: "Cards", value: mints.join("\n") },
        {
          label: "Shipping",
          value: Output.formatDollar(quote.shippingUsd ?? 0, { decimals: 2 }),
        },
        {
          label: "Insurance",
          value: Output.formatDollar(quote.insuranceUsd ?? 0, { decimals: 2 }),
        },
        {
          label: "Fees",
          value: Output.formatDollar(quote.feesUsd ?? 0, { decimals: 2 }),
        },
        {
          label: "Total",
          value: Output.formatDollar(quote.totalUsd ?? 0, { decimals: 2 }),
        },
      ],
    });
  }
}
