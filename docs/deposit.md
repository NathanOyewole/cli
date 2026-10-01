# Deposit

Ways to get funds into your Solana wallet: your address and cross-chain deposit addresses, a fiat onramp link, and bridge quotes. All commands are read-only.

## Commands

### Receive

```bash
jup deposit receive
jup deposit receive --key mykey
jup deposit receive --address <wallet-address>
```

- Shows your Solana address, plus a deposit address on each supported chain (Ethereum, Base, Arbitrum, BSC, Sui, ...). Tokens sent to a deposit address arrive in your Solana wallet automatically.
- Send at least `minDeposit` of the chain's `token`; `feeUsd` is charged per deposit
- Chains the API reports as unavailable are omitted
- To move funds from an exchange, withdraw to the Solana `address`
- `--key` and `--address` are mutually exclusive (also for `onramp`); with neither, the active key's wallet is used

```js
// Example JSON response:
{
  "address": "5tz...Ai9", // your Solana address
  "depositAddresses": [
    {
      "chain": "Ethereum",
      "chainId": 1,
      "depositAddress": "0xe9e4...84B2",
      "token": "0xA0b8...eB48", // token contract to send (USDC here)
      "minDeposit": "10", // in token units
      "feeUsd": 0.3,
      "status": "healthy"
    }
  ]
}
```

### Buy with fiat

```bash
jup deposit onramp
jup deposit onramp --address <wallet-address>
```

- Returns a signed Onramper checkout link that buys SOL into the wallet. Open it in a browser.

```js
// Example JSON response:
{
  "address": "5tz...Ai9",
  "url": "https://buy.onramper.com/?apiKey=...&networkWallets=solana%3A5tz...Ai9&..."
}
```

### Bridge tokens

```bash
jup deposit bridge-tokens --chain base --search usdc
```

- `--chain` is required: `solana`, `ethereum`, `base`, `arbitrum`, `sui`, `bnb`, `robinhood`, `optimism`, `polygon`, `avalanche`, `linea`
- `--search` filters by symbol, name or address; `--limit` is a positive integer (default 20)

```js
// Example JSON response:
[
  {
    "chain": "base",
    "address": "0x8335...2913",
    "symbol": "USDC",
    "name": "USD Coin",
    "decimals": 6,
    "isNative": false
  }
]
```

### Bridge quote

```bash
jup deposit bridge-quote --from-chain ethereum --from-token USDC --to-token USDC --amount 100
jup deposit bridge-quote --from-chain solana --from-token SOL --to-chain base --to-token ETH --amount 1
```

- Compares the Universal and deBridge routes. `--to-chain` defaults to `solana`; it must differ from `--from-chain`.
- `--from-chain`, `--from-token` and `--to-token` are required. Exactly one of `--amount` (human-readable, input token) or `--raw-amount` (on-chain units) is required.
- Tokens are symbols or addresses on their chain (exact match; use `bridge-tokens` to look them up)
- `routes` are sorted by `outAmount`, best first. In table mode, no routes is an error; JSON returns an empty `routes` with the `failures`.
- The CLI only quotes. On jup.ag the bridge transfer runs in the provider's widget at https://jup.ag/deposit/bridge. To bridge into Solana, `jup deposit receive` deposit addresses are the CLI path.

```js
// Example JSON response:
{
  "inputToken": { "chain": "ethereum", "address": "0xA0b8...eB48", "symbol": "USDC", "decimals": 6 },
  "outputToken": { "chain": "solana", "address": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "inAmount": "100",
  "routes": [
    { "provider": "universal", "outAmount": "99.9" }, // best first
    { "provider": "debridge", "outAmount": "98.846984" }
  ],
  "failures": [] // { provider, reason: "quote-too-low" | "not-configured" | "unavailable" }
}
```
