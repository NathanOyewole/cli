import { describe, expect, test } from "bun:test";

import { ClientConfig } from "./ClientConfig.ts";

const rateLimited = ClientConfig.ky.extend({
  fetch: async () =>
    new Response("Rate limit exceeded, please try again later.", {
      status: 429,
    }),
  retry: 0,
});

describe("ClientConfig.ky", () => {
  test("turns a plain-text 429 into a readable error", async () => {
    await expect(
      rateLimited.get("https://lite-api.jup.ag/ultra/v1/order").json()
    ).rejects.toThrow(
      "Rate limited by the Jupiter API. Retry shortly, or set an API key with `jup config set --api-key <key>` for higher limits."
    );
  });

  test("still reports the 429 when a caller disables throwHttpErrors", async () => {
    await expect(
      rateLimited
        .get("https://lite-api.jup.ag/ultra/v1/order", {
          throwHttpErrors: false,
        })
        .json()
    ).rejects.toThrow("Rate limited by the Jupiter API.");
  });
});

describe("ClientConfig.sendsApiKey", () => {
  test("sends the key only to api.jup.ag", () => {
    expect(
      [
        "https://api.jup.ag/ultra/v1/order",
        "https://lite-api.jup.ag/ultra/v1/order",
        "https://datapi.jup.ag/v1/assets/search",
        "https://api.solana.fluid.io/v2/lending/tokens",
        "https://gum-api.jup.net/fe/mainnet-beta/perps/markets",
        "https://jup.ag/api/gacha/marketplace",
      ].map((url) => ClientConfig.sendsApiKey(url))
    ).toEqual([true, false, false, false, false, false]);
  });
});
