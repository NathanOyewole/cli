import ky from "ky";

import { Config } from "../lib/Config.ts";

export class ClientConfig {
  static readonly #API_KEY = Config.load().apiKey;

  public static readonly host = this.#API_KEY
    ? "https://api.jup.ag"
    : "https://lite-api.jup.ag";

  public static readonly ky = ky.create({
    headers: {
      "x-client-platform": "jupiter.cli",
      ...(this.#API_KEY && {
        "x-api-key": this.#API_KEY,
      }),
    },
    hooks: {
      afterResponse: [
        (_request, _options, response) => {
          if (response.status === 429) {
            throw new Error(
              "Rate limited by the Jupiter API. Retry shortly, or set an API key with `jup config set --api-key <key>` for higher limits."
            );
          }
        },
      ],
    },
  });
}
