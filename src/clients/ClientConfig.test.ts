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
