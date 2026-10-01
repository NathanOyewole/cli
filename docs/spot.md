# Spot Trading

Requires: an active key for swap, transfer, limit order and DCA commands. See [setup](setup.md).

## Token resolution

Anywhere a token is specified (`--from`, `--to`, `--token`, `--search`), you can use either:

- **Symbol** (e.g. `SOL`, `USDC`, `JUP`) — the CLI auto-resolves to the best-matching token
- **Mint address** (e.g. `So11111111111111111111111111111111111111112`) — exact match

Token resolution depends on the context:

- **Wallet-bound options** (`swap --from`, `transfer --token`, `reclaim --token`, `limit open --from`, `dca open --from`) resolve against the tokens in your wallet. This ensures the CLI matches the token you actually hold, not a different token with the same symbol. If the token is not found in your wallet, the command errors. If multiple tokens share the same symbol, the CLI asks you to use the mint address instead.
- **All other options** (`swap --to`, `quote --from`, `quote --to`, `tokens --search`, `history --token`) resolve via Jupiter's global token search, picking the top result.

## Commands

### Search tokens

```bash
jup spot tokens --search <query>
jup spot tokens --search <query> --limit 5
jup spot tokens --search <mint-address>
jup spot tokens --search "<mint1>,<mint2>"
```

### Get a swap quote

```bash
jup spot quote --from SOL --to USDC --amount 1
jup spot quote --from <mint> --to <mint> --raw-amount 1000000000
jup spot quote --from SOL --to USDC --amount 100 --exact-out
jup spot quote --from SOL --to USDC --amount 1 --exclude-routers jupiterz --exclude-dexes "Raydium,Meteora DLMM"
```

- `--amount` uses human-readable units (e.g. `1` SOL = 1 SOL)
- `--raw-amount` uses on-chain units (e.g. `1000000000` lamports = 1 SOL)
- Exactly one of `--amount` or `--raw-amount` is required
- `--exact-out` treats the amount as the exact output amount (in `--to` units) and quotes the required input
- `--exclude-dexes` / `--exclude-routers` take comma-separated DEX labels / router IDs (`metis`, `jupiterz`, `hashflow`, `dflow`)
- `warnings` lists Jupiter Shield warnings for both tokens (e.g. transfer fees, freeze authority, not verified). They are advisory; `null` if Shield could not be reached

```js
// Example JSON response:
{
  "inputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "outputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "inAmount": "1", // human-readable decimal amount
  "outAmount": "84.994059", // human-readable decimal amount
  "inUsdValue": 84.98, // USD value
  "outUsdValue": 84.99,
  "priceImpact": 0.005, // max value of 100; 0.005 means 0.005%
  "warnings": [
    {
      "token": { "id": "4zfw...CPTE", "symbol": "ZCOIN", "decimals": 6 },
      "type": "3%_TRANSFER_FEES",
      "severity": "warning", // "info", "warning" or "critical"
      "message": "This token has a transfer fee of 3%"
    }
  ]
}
```

### Execute a swap

```bash
jup spot swap --from SOL --to USDC --amount 1
jup spot swap --from SOL --to USDC --amount 1 --key mykey
jup spot swap --from SOL --to USDC --amount 1 --slippage 50
jup spot swap --from SOL --to USDC --amount 1 --dry-run
jup spot swap --from SOL --to USDC --amount 100 --exact-out
jup spot swap --from SOL --to USDC --amount 1 --priority-fee 50000 --fee-type exact-fee
jup spot swap --from SOL --to USDC --amount 1 --jito-tip 10000 --exclude-routers jupiterz
```

- `--key` overrides the active key for this transaction
- `--slippage` sets max slippage in basis points (e.g. `50` = 0.5%). Recommended to be emtpy: Jupiter's Real-Time Slippage Estimation (RTSE) automatically picks an optimal value.
- `--dry-run` previews the swap without signing or submitting. The API still simulates the transaction, so errors like insufficient balance are caught. In JSON mode, the response includes the unsigned base64 `transaction` for external signing.
- `warnings` lists Jupiter Shield warnings for both tokens (same shape as `quote`). They never block the swap.

Manual swap settings (the same ones as the jup.ag "Manual" settings panel). Leave them out to let Jupiter pick automatically:

- `--exact-out`: the amount is the exact output amount (in `--to` units)
- `--priority-fee <lamports>`: priority fee for the transaction
- `--jito-tip <lamports>`: Jito tip (min 1000 lamports); can be combined with `--priority-fee`
- `--fee-type <max-cap|exact-fee>`: whether `--priority-fee`/`--jito-tip` is a cap (the jup.ag default) or the exact amount to pay
- `--use-wsol`: use wrapped SOL instead of native SOL
- `--exclude-dexes <labels>`: comma-separated DEX labels to route around (e.g. `"Raydium,Meteora DLMM"`)
- `--exclude-routers <ids>`: comma-separated routers to skip: `metis`, `jupiterz`, `hashflow`, `dflow`

```js
// Example JSON response:
{
  "trader": "ABC1...xyz", // trader address
  "signature": "3dV98zG...", // tx signature viewable on an explorer
  "inputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "outputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "inAmount": "1", // human-readable decimal amount
  "outAmount": "84.95", // human-readable decimal amount
  "inUsdValue": 84.98,
  "outUsdValue": 84.95,
  "priceImpact": 0.005, // max value of 100; 0.005 means 0.005%
  "networkFeeLamports": 5000, // divide by 10^9 for SOL fee
  "warnings": [] // Shield warnings, see quote
}
```

### View portfolio

```bash
jup spot portfolio
jup spot portfolio --key mykey
jup spot portfolio --address <wallet-address>
```

- With no options, uses the active key's wallet
- `--address` looks up any wallet without needing a key

```js
// Example JSON response:
{
  "totalValue": 1250.50, // total USD net worth
  "tokens": [
    {
      "id": "So11...1112", // mint address
      "symbol": "SOL",
      "decimals": 9,
      "amount": 10.5, // human-readable decimal balance
      "rawAmount": "10500000000", // on-chain integer balance
      "value": 892.50, // USD value of holdings
      "price": 85.00, // current token USD price
      "priceChange": 0.032, // 24h price change; 0.032 means 3.2%
      "isVerified": true
    }
  ]
}
```

### Reclaim rent from ATA

```bash
jup spot reclaim
jup spot reclaim --key mykey
jup spot reclaim --token USDC
jup spot reclaim --dry-run
```

- With no options, reclaims rent from all empty Associated Token Accounts (ATA) owned by the active key's wallet
- `--dry-run` previews reclaimable amount without executing. JSON response includes the unsigned base64 `transactions` array.

```js
// Example JSON response:
{
  "totalLamportsReclaimed": 5000, // divide by 10^9 for total SOL reclaimed
  "totalValueReclaimed": 0.005, // USD value of reclaimed SOL
  "networkFeeLamports": 5000, // divide by 10^9 for SOL fee
  "signatures": [ // array of tx signatures for each batch of reclaim tx
    "3dV98zG...",
  ]
}
```

### View trade history

```bash
jup spot history --address <wallet-address>
jup spot history --key mykey
jup spot history --address <wallet-address> --token SOL
jup spot history --address <wallet-address> --after 2025-01-01 --before 2025-02-01
jup spot history --address <wallet-address> --limit 10 --offset 123
```

- With no `--address` or `--key`, uses the active key's wallet
- `--token` filters by token (symbol or mint address)
- `--after` / `--before` accept ISO 8601 dates or UNIX timestamps
- `--limit` defaults to 10, max 15
- `--offset` is used for pagination; use the `next` value from the previous response to fetch the next page of results

```js
// Example JSON response:
{
  "trades": [
    {
      "time": "2025-01-15T10:30:00.000Z", // ISO 8601 timestamp
      "inputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
      "outputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
      "inAmount": "1", // human-readable decimal amount
      "outAmount": "84.994059", // human-readable decimal amount
      "inUsdValue": 84.98, // USD value
      "outUsdValue": 84.99,
      "signature": "3dV98zG..." // tx signature
    }
  ],
  "next": "123" // pagination offset for next page of results; use with --offset to fetch next page
}
```

### Transfer tokens

```bash
jup spot transfer --token SOL --to <recipient-address> --amount 1
jup spot transfer --token USDC --to <recipient-address> --amount 50
jup spot transfer --token <mint> --to <recipient-address> --raw-amount 1000000000
jup spot transfer --token SOL --to <recipient-address> --amount 1 --key mykey
jup spot transfer --token SOL --to <recipient-address> --amount 1 --dry-run
```

- Works with both SOL and any SPL token
- `--token` accepts a symbol or mint address
- `--dry-run` previews the transfer without signing. JSON response includes the unsigned base64 `transaction`.

```js
// Example JSON response:
{
  "sender": "ABC1...xyz", // sender address
  "recipient": "DEF2...abc",
  "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "amount": "50", // human-readable decimal amount
  "value": 50.00, // USD value of transfer
  "networkFeeLamports": 5000, // divide by 10^9 for SOL fee
  "signature": "4xK29zH..." // tx signature viewable on an explorer
}
```

### Limit orders

Limit orders are held in a per-wallet Jupiter vault and filled by Jupiter when the trigger token's USD price is hit. Placing an order deposits the input token into the vault; cancelling withdraws what is left.

#### Sign-in

Limit order and DCA commands (except the `--v1` commands) sign in to the Jupiter Trigger API by signing a text challenge with your key. This is a message signature, not a transaction. The session is cached in `~/.config/jup/auth/<address>.json` (mode 0600) and refreshed automatically. `--dry-run` still signs this challenge, and `open` registers your vault on first use, but no transaction is signed or submitted.

#### Place a limit order

```bash
# Sell SOL for USDC when SOL reaches $250 (take profit)
jup spot limit open --from SOL --to USDC --amount 1 --intent take-profit --price 250

# Sell SOL if it drops 10% from the current price (stop loss)
jup spot limit open --from SOL --to USDC --amount 1 --intent stop-loss --price -10%

# Buy JUP with USDC when JUP drops to a $500M market cap
jup spot limit open --from USDC --to JUP --amount 50 --intent buy-dip --price 500000000 --mcap

# Buy JUP when it breaks above $1
jup spot limit open --from USDC --to JUP --amount 50 --intent buy-pump --price 1

# Trailing stop: sell SOL once it falls 5% from its highest price
jup spot limit open --from SOL --to USDC --amount 1 --intent trailing-stop --trailing 5

# One cancels other: take profit at +20% or stop loss at -10%
jup spot limit open --from SOL --to USDC --amount 1 --intent oco --tp +20% --sl -10%

# Buy JUP at $0.30, then take profit at +30% / stop loss at -10% from entry
jup spot limit open --from USDC --to JUP --amount 50 --intent otoco --price 0.3 --tp +30% --sl -10%

# Custom expiry and slippage, dry-run
jup spot limit open --from SOL --to USDC --amount 1 --intent take-profit --price 250 --expiry 1d --slippage 100 --dry-run
```

| `--intent`      | Side | Watches price of | Triggers when                                       | Prices                              |
| --------------- | ---- | ---------------- | --------------------------------------------------- | ----------------------------------- |
| `take-profit`   | sell | `--from`         | above `--price`                                     | `--price`                           |
| `stop-loss`     | sell | `--from`         | below `--price`                                     | `--price`                           |
| `buy-dip`       | buy  | `--to`           | below `--price`                                     | `--price`                           |
| `buy-pump`      | buy  | `--to`           | above `--price`                                     | `--price`                           |
| `trailing-stop` | sell | `--from`         | falls `--trailing`% from its peak                   | `--trailing` (0.5–90, steps of 0.5) |
| `oco`           | sell | `--from`         | above `--tp` or below `--sl`; one cancels the other | `--tp`, `--sl`                      |
| `otoco`         | buy  | `--to`           | entry at `--price`, then `--tp` / `--sl` exits      | `--price`, `--tp` and/or `--sl`     |

- `--amount` / `--raw-amount` is the amount of `--from` to sell. Minimum order size is $10
- `--price`, `--tp` and `--sl` accept a USD price (`250`), or a signed percentage from the current price (`+10%`, `-5%`). For `otoco`, `--tp`/`--sl` percentages are relative to the entry `--price`
- `--mcap` reads `--price`, `--tp` and `--sl` as market caps in USD (converted with the token's circulating supply)
- `--slippage` (bps) applies to every leg of the order. When omitted, stop-loss legs, trailing stops and `buy-pump` use 2000 (20%) and everything else lets Jupiter pick (`null`), matching jup.ag
- `--expiry` defaults to `7d`. Presets `1h`, `1d`, `7d`, `30d`, or any duration (`30m`, `12h`, `2w`, `1mo`, or seconds), up to 10 years
- Stablecoins cannot be trigger tokens and some pairs are unsupported; the command checks the pair before depositing
- `--dry-run` returns the unsigned deposit `transaction` without creating the order

```js
// Example JSON response:
{
  "orderId": "01a0f4bc-...", // use with set/close; null in dry-run
  "intent": "oco",
  "orderType": "oco", // "single", "oco" or "otoco"
  "inputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "outputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "triggerToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 }, // token whose USD price is watched
  "inAmount": "1", // human-readable decimal amount
  "inUsdValue": 117.95,
  "triggerCondition": null, // "above" or "below" for single and otoco orders
  "triggerPriceUsd": null, // trigger price, or entry price for otoco
  "trailingBps": null, // trailing distance; 500 means 5%
  "tpPriceUsd": 141.55,
  "slPriceUsd": 106.16,
  "slippageBps": null, // null means Jupiter picks the slippage
  "tpSlippageBps": null,
  "slSlippageBps": 2000,
  "expiresAt": "2026-10-08T00:07:43.500Z",
  "signature": "3dV98zG..." // deposit tx signature; null in dry-run
}
```

#### View limit orders

```bash
jup spot limit orders # open orders
jup spot limit history # filled, cancelled and expired orders
jup spot limit orders --token SOL
jup spot limit history --limit 20 --offset 20
jup spot limit orders --key mykey
```

- `--limit` defaults to 10 (max 100); use `next` as `--offset` for the next page
- `--token` filters by input or output token

```js
// Example JSON response:
{
  "count": 12, // total matching orders
  "orders": [
    {
      "orderId": "01a0f4bc-...",
      "intent": "take-profit",
      "orderType": "single",
      "state": "open", // pending, open, executing, filled, pending_withdraw, cancelled, expired, failed
      "inputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
      "outputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
      "triggerToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
      "inAmount": "1",
      "remainingInAmount": "1",
      "outAmount": null, // amount received so far; null if nothing filled
      "triggerCondition": "above",
      "triggerPriceUsd": 250,
      "trailingBps": null,
      "tpPriceUsd": null,
      "slPriceUsd": null,
      "slippageBps": null,
      "tpSlippageBps": null,
      "slSlippageBps": null,
      "fillPct": 0, // percentage; 50 means 50% filled
      "expiresAt": "2026-10-08T00:07:43.500Z",
      "createdAt": "2026-10-01T00:07:43.500Z",
      "updatedAt": "2026-10-01T00:07:45.000Z"
    }
  ],
  "next": 10 // pagination offset for next page; omitted when no more results
}
```

#### Update a limit order

```bash
jup spot limit set --order <orderId> --price 260
jup spot limit set --order <orderId> --tp +25% --sl 100
jup spot limit set --order <orderId> --trailing 7.5
jup spot limit set --order <orderId> --slippage 300
```

- Single orders accept `--price` (or `--trailing` for trailing stops); `oco` accepts `--tp`/`--sl`; `otoco` accepts `--price`, `--tp` and `--sl`. `--slippage` updates every leg. `--mcap` works as in `open`
- Updates need no transaction. `--dry-run` shows the update without applying it

```js
// Example JSON response (only updated fields are included):
{
  "orderId": "01a0f4bc-...",
  "orderType": "single",
  "triggerPriceUsd": 260
}
```

#### Cancel a limit order

```bash
jup spot limit close --order <orderId>
jup spot limit close --order <orderId> --dry-run
```

- Cancelling withdraws the remaining input from the vault back to your wallet. `--dry-run` requests and returns the unsigned withdrawal `transaction` without confirming the cancel

```js
// Example JSON response:
{
  "orderId": "01a0f4bc-...",
  "inputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "remainingInAmount": "1", // amount withdrawn
  "signature": "4xK29zH..."
}
```

#### Legacy V1 limit orders

Orders placed with the previous limit order program can still be listed and cancelled with `--v1`. V1 commands do not need sign-in, so lists accept `--address`:

```bash
jup spot limit orders --v1 --address <wallet-address>
jup spot limit history --v1
jup spot limit close --v1 --order <orderId>
jup spot limit close --v1 --order all # cancel every open V1 order
```

- V1 orders use the same list shape, with `orderType: "v1"`, `intent: null`, no trigger prices, and `outAmount` set to the requested output amount
- V1 `close` returns `{ "orderIds": [...], "signatures": [...] }` (one transaction per batch of up to 5 orders); `--dry-run` returns the unsigned `transactions`

### DCA (recurring) orders

DCA orders split a total amount into equal orders bought at a fixed interval. Funds are held in the same Jupiter vault as limit orders and use the same [sign-in](#sign-in).

#### Create a DCA order

```bash
# Spend 100 USDC on SOL over 10 daily orders
jup spot dca open --from USDC --to SOL --amount 100 --orders 10 --interval 1d

# Only buy while SOL is between $80 and $150
jup spot dca open --from USDC --to SOL --amount 100 --orders 10 --interval 1d --min-price 80 --max-price 150

# Earn Jupiter Lend yield on the USDC that is waiting to be spent
jup spot dca open --from USDC --to SOL --amount 100 --orders 4 --interval 1w --earn
```

- `--amount` / `--raw-amount` is the total amount to spend; each order is `amount / orders`
- `--orders` is between 2 and 100; each order must be worth at least $10
- `--interval` is `30m`, `1h`, `1d`, `1w`, `1mo` (30 days), any multiple (e.g. `4h`), or seconds; between 1 minute and 1 year
- `--min-price` / `--max-price` (USD price of `--to`) skip orders outside the range
- `--earn` ("Earn while you wait") is only for USDC, USDT or JupUSD inputs without a price range
- `--dry-run` returns the unsigned deposit `transaction` without creating the order

```js
// Example JSON response:
{
  "orderId": "01a0f4bc-...", // null in dry-run
  "inputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "outputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
  "inAmount": "100",
  "inUsdValue": 99.98,
  "orderCount": 10,
  "inAmountPerOrder": "10",
  "intervalSeconds": 86400,
  "minPriceUsd": null,
  "maxPriceUsd": null,
  "earn": false,
  "signature": "3dV98zG..." // deposit tx signature; null in dry-run
}
```

#### View DCA orders

```bash
jup spot dca orders # active orders
jup spot dca history # completed and cancelled orders
jup spot dca orders --token SOL --limit 20
jup spot dca orders --v1 --address <wallet-address> # legacy V1 orders
```

- `--v1` lists legacy V1 orders (no sign-in, so `--address` works; `--token` is not supported). V1 entries have `nextOrderAt: null` and no price range

```js
// Example JSON response:
{
  "count": 1,
  "orders": [
    {
      "orderId": "01a0f4bc-...",
      "state": "active", // pending, active, executing, cancelling, pending_withdraw, completed, cancelled, failed
      "inputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
      "outputToken": { "id": "So11...1112", "symbol": "SOL", "decimals": 9 },
      "inAmount": "100",
      "remainingInAmount": "70",
      "inAmountPerOrder": "10",
      "outAmount": "0.25", // total bought so far
      "orderCount": 10,
      "ordersFilled": 3,
      "intervalSeconds": 86400,
      "minPriceUsd": null,
      "maxPriceUsd": null,
      "earn": false,
      "earnedUsd": null, // yield earned with --earn
      "nextOrderAt": "2026-10-02T00:00:00.000Z",
      "createdAt": "2026-09-28T00:00:00.000Z"
    }
  ],
  "next": 10 // omitted when no more results
}
```

#### Cancel a DCA order

```bash
jup spot dca close --order <orderId>
jup spot dca close --order <orderId> --dry-run
```

- `--dry-run` requests and returns the unsigned withdrawal `transaction` without confirming the cancel
- Legacy V1 DCA orders are closed with `jup spot dca close --v1 --order <order-account>`. The CLI builds the close transaction itself and sends it through your RPC (`jup config set --rpc-url`); unspent input and bought tokens return to your wallet, and wrapped SOL is unwrapped.

```js
// Example JSON response:
{
  "orderId": "01a0f4bc-...",
  "inputToken": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "remainingInAmount": "70", // amount withdrawn
  "ordersRemaining": 7,
  "signature": "4xK29zH..."
}
```

## Workflows

### Dry-run then swap

```bash
jup spot swap --from SOL --to USDC --amount 1 --dry-run
# Review the output, fees, and simulation result
jup spot swap --from SOL --to USDC --amount 1
```

### Look up a token by mint address

```bash
jup spot tokens --search <mint-address>
```

### Check holdings then transfer

```bash
jup spot portfolio
jup spot transfer --token USDC --to <recipient-address> --amount 50
```

### Protect a position with a take profit and stop loss

```bash
jup spot limit open --from SOL --to USDC --amount 1 --intent oco --tp +20% --sl -10%
jup spot limit orders
# Copy the orderId to adjust or cancel
jup spot limit set --order <orderId> --sl -5%
jup spot limit close --order <orderId>
```
