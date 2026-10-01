# Perpetual Futures Trading

Requires: an active key for write commands. Read commands (`markets`, `jlp info`, `loans info`, `leaderboard`, and `positions`/`history`/`stats`/`loans positions`/`loans history` with `--address`) need none. See [setup](setup.md).

## Markets

Three perpetual markets are available: **SOL**, **BTC**, and **ETH**. Collateral can be deposited in SOL, BTC, ETH, or USDC. Minimum collateral is $10 for new positions.

## Commands

### View positions

```bash
jup perps positions
jup perps positions --key mykey
jup perps positions --address <wallet-address>
```

- Shows open positions with TP/SL details, and pending limit orders
- With no options, uses the active key's wallet

```js
// Example JSON response:
{
  "positions": [
    {
      "positionPubkey": "3qMZ...83tz", // use this to close or set TP/SL
      "asset": "BTC",
      "side": "long",
      "leverage": 1.09,
      "sizeUsd": 10.98, // position size in USD
      "entryPriceUsd": 70522.85,
      "markPriceUsd": 70424.52,
      "pnlPct": -0.29, // percentage; -0.29 means -0.29%
      "liquidationPriceUsd": 6601.55,
      "tpsl": [
        {
          "pubkey": "7xKp...2mNq", // use this to cancel TP/SL
          "type": "tp",
          "triggerPriceUsd": 75000
        }
      ]
    }
  ],
  "limitOrders": [
    {
      "orderPubkey": "9fGh...4kLm", // use this to update or cancel
      "asset": "SOL",
      "side": "long",
      "sizeUsd": 50,
      "triggerPriceUsd": 80
    }
  ]
}
```

### View trade history

```bash
jup perps history
jup perps history --key mykey
jup perps history --address <wallet-address>

# Filter by asset, side, or action
jup perps history --asset SOL --side long
jup perps history --action Decrease

# Filter by date range
jup perps history --after 2026-03-01 --before 2026-03-15

# Limit results (default: 20)
jup perps history --limit 5

# Export the full trade history as CSV (same file as the web's export)
jup perps history --address <wallet-address> --export trades.csv
```

- Shows past trades (opens, closes) with PnL and fees
- `--after` and `--before` accept date strings (e.g. `2026-03-01`) or UNIX timestamps
- `pnlUsd` and `pnlPct` are `null` for Increase (open) actions

```js
// Example JSON response:
{
  "count": 42, // total matching trades
  "trades": [
    {
      "time": "2026-03-10T14:30:00.000Z",
      "asset": "SOL",
      "side": "long",
      "action": "Decrease",
      "sizeUsd": 11.66,
      "priceUsd": 93.22,
      "pnlUsd": 0.63, // null for Increase actions
      "pnlPct": 5.97, // percentage; 5.97 means +5.97%
      "feeUsd": 0.01,
      "signature": "2Goj...diEc"
    }
  ]
}

// Example JSON response (--export):
{
  "path": "trades.csv",
  "trades": 41 // rows written
}
```

### List markets

```bash
jup perps markets
```

```js
// Example JSON response:
[
  {
    "asset": "SOL",
    "priceUsd": 86.74,
    "changePct24h": 2.35, // percentage; 2.35 means +2.35%
    "highUsd24h": 88.10,
    "lowUsd24h": 84.50,
    "volumeUsd24h": 1250000,
    "openFeePct": 0.06, // percentage of size charged on open/close
    "maxPriceImpactFeePct": 0.44,
    "longBorrowRatePctPerHour": 0.0016, // hourly borrow rate paid by longs
    "shortBorrowRatePctPerHour": 0.0007,
    "longAvailableLiquidityUsd": 10000000, // max new long size right now
    "shortAvailableLiquidityUsd": 10000000,
    "longUtilizationPct": 13.8,
    "shortUtilizationPct": 61.68
  }
]
```

### Open a position

Two sizing modes — provide either `--leverage` or `--size`, not both:

- `--leverage`: position size = amount × leverage
- `--size`: explicit position size in USD, leverage is derived

```bash
# Market order with leverage
jup perps open --asset SOL --side long --amount 10 --input USDC --leverage 2

# Market order with explicit size
jup perps open --asset BTC --side short --amount 10 --input USDC --size 50

# Use SOL as collateral (default --input)
jup perps open --asset SOL --side long --amount 0.1 --leverage 5

# With take-profit and stop-loss
jup perps open --asset ETH --side long --amount 10 --input USDC --leverage 3 --tp 4000 --sl 3000

# Limit order (triggers when price reaches --limit)
jup perps open --asset BTC --side long --amount 10 --input USDC --leverage 2 --limit 65000

# Dry-run to preview without executing
jup perps open --asset SOL --side long --amount 0.2 --leverage 2 --dry-run
```

- `--side` accepts `long`, `short`, `buy` (= long), or `sell` (= short)
- `--input` defaults to SOL; accepts SOL, BTC, ETH, or USDC
- `--slippage` defaults to 200 (2%); set in basis points
- `--tp` and `--sl` cannot be combined with `--limit`
- `--dry-run` previews the order without signing. The API simulates the transaction, returning entry price, size, leverage, liquidation price, and fees. JSON response includes the unsigned base64 `transaction`.

```js
// Example JSON response (market order):
{
  "type": "market-order",
  "positionPubkey": "A7SQ...q96c",
  "asset": "SOL",
  "side": "long",
  "entryPriceUsd": 86.74,
  "sizeUsd": 10.97,
  "leverage": 1.09,
  "liquidationPriceUsd": 8.12,
  "openFeeUsd": 0.0066,
  "signature": "2Goj...diEc"
}

// Example JSON response (limit order):
{
  "type": "limit-order",
  "positionPubkey": "B8TR...p23d",
  "asset": "BTC",
  "side": "long",
  "triggerPriceUsd": 65000,
  "sizeUsd": 20,
  "leverage": 2,
  "signature": "4xK2...9zH1"
}
```

### Update TP/SL, collateral, or limit order

```bash
# Set or update take-profit on a position
jup perps set --position <pubkey> --tp 100

# Set or update stop-loss on a position
jup perps set --position <pubkey> --sl 70

# Set both TP and SL
jup perps set --position <pubkey> --tp 100 --sl 70

# Partial TP/SL: close only $50 of size at the trigger (stackable)
jup perps set --position <pubkey> --tp 110 --size 50

# Add collateral (lowers leverage); amount is in --input token units
jup perps set --position <pubkey> --add-collateral 0.5
jup perps set --position <pubkey> --add-collateral 20 --input USDC

# Remove $25 of collateral (raises leverage)
jup perps set --position <pubkey> --remove-collateral 25 --receive USDC

# Update a limit order's trigger price
jup perps set --order <pubkey> --limit 64000

# Dry-run
jup perps set --position <pubkey> --tp 100 --sl 70 --dry-run
```

- Get the `positionPubkey` or `orderPubkey` from `jup perps positions`
- Without `--size`, `--tp`/`--sl` update the whole-position TP/SL if one exists, otherwise create it. With `--size`, a new partial TP/SL is always created; a position can hold several, up to a server limit (the error says how many).
- `--add-collateral` and `--remove-collateral` keep the position size unchanged. `--input`/`--receive` default to the position's collateral token. Amounts outside the server's per-position limits are rejected with the allowed range.
- A limit order's size cannot be edited (the web app doesn't allow it either): cancel and re-open instead.
- `--dry-run` previews the update without signing. JSON response includes the unsigned base64 `transaction` for each update.

```js
// Example JSON response (update limit order):
{
  "action": "update-limit-order",
  "triggerPriceUsd": 64000,
  "signature": "5tPb...qdCD"
}

// Example JSON response (set TP/SL):
{
  "action": "set-tpsl",
  "updates": [
    {
      "type": "tp",
      "action": "created", // or "updated"
      "triggerPriceUsd": 100,
      "sizeUsd": null, // USD size closed by a partial TP/SL; null = whole position
      "signature": "3dV9...8zG1"
    },
    {
      "type": "sl",
      "action": "created",
      "triggerPriceUsd": 70,
      "sizeUsd": null,
      "signature": "7kM2...4pQ3"
    }
  ]
}

// Example JSON response (add/remove collateral):
{
  "action": "remove-collateral", // or "add-collateral"
  "positionPubkey": "3qMZ...83tz",
  "collateralUsd": 8487.41, // collateral after the change
  "collateralDeltaUsd": -300, // negative when removing
  "leverage": 34.55, // leverage after the change
  "liquidationPriceUsd": 114.27,
  "received": "74.07 USDC", // null when adding; accrued borrow fees are settled first
  "feeUsd": 225.93,
  "signature": "5YhT...9AKU"
}
```

### Close a position or cancel an order

```bash
# Close entire position (receive collateral token by default)
jup perps close --position <pubkey>

# Close entire position, receive USDC
jup perps close --position <pubkey> --receive USDC

# Partial close (reduce by $5)
jup perps close --position <pubkey> --size 5

# Close all positions
jup perps close --position all

# Cancel a limit order
jup perps close --order <pubkey>

# Cancel a TP/SL order
jup perps close --tpsl <pubkey>

# Close all expired limit orders and reclaim their deposits
jup perps close --order expired

# Dry-run
jup perps close --position <pubkey> --dry-run
```

- `--receive` defaults to the position's collateral token; must be USDC or the market token (e.g. BTC for a BTC position)
- `--size` for partial close; omit to close entirely
- `--dry-run` previews the close without signing, showing PnL, fees, and received amount. JSON response includes the unsigned base64 `transaction`.

```js
// Example JSON response (close/decrease position):
{
  "action": "close-position", // or "decrease-position" for partial
  "positionPubkey": "3qMZ...83tz",
  "sizeReducedUsd": 10.98,
  "pnlUsd": 0.15,
  "pnlPct": 1.37, // percentage; 1.37 means +1.37%
  "received": "0.00015 BTC",
  "receivedUsd": 10.50,
  "feesUsd": 0.007,
  "signature": "5YhT...9AKU"
}

// Example JSON response (close all):
{
  "action": "close-all",
  "signatures": ["5YhT...9AKU", "3Cn8...diEc"]
}

// Example JSON response (close expired orders):
{
  "action": "close-expired-orders",
  "orders": ["9fGh...4kLm"], // expired order pubkeys, empty if none
  "signatures": ["4wYb...drLf"] // sent straight to Solana via your RPC (config set --rpc-url)
}

// Example JSON response (cancel order):
{
  "action": "cancel-limit-order", // or "cancel-tpsl"
  "signature": "4wYb...drLf"
}
```

### JLP: pool info, mint, burn

JLP is the liquidity token of the perps pool; holders earn trading fees. Mint and burn transactions are sent straight to Solana through your RPC (`jup config set --rpc-url <url>`), as the web app does.

```bash
jup perps jlp info

# Mint JLP with a pool token (SOL, ETH, BTC, USDC, JUPUSD; default USDC)
jup perps jlp mint --amount 100 --input USDC
jup perps jlp buy --amount 0.5 --input SOL   # alias

# Burn JLP for a pool token (default USDC)
jup perps jlp burn --amount 20 --receive SOL
jup perps jlp sell --amount 20               # alias
```

```js
// Example JSON response (info):
{
  "priceUsd": 4.8358,
  "aprPct": 9.69,
  "apyPct": 10.17,
  "aumUsd": 936106690.12,
  "aumLimitUsd": 3000000000,
  "totalSupply": 193577501.856,
  "aprUpdatedAt": "2026-09-26T12:15:01.000Z",
  "custodies": [
    {
      "asset": "SOL",
      "mint": "So11111111111111111111111111111111111111112",
      "amount": 3927573.99, // tokens held by the pool
      "valueUsd": 451388226.31,
      "weightPct": 48.21,
      "targetWeightPct": 47,
      "utilizationPct": 13.74 // share lent to traders
    }
  ]
}

// Example JSON response (mint):
{
  "action": "mint-jlp",
  "input": "SOL",
  "inputAmount": "0.5",
  "jlpAmount": 12.189827, // JLP received
  "feePct": 0.22,
  "signature": "4xK2...9zH1"
}

// Example JSON response (burn):
{
  "action": "burn-jlp",
  "jlpAmount": "100",
  "receive": "BTC",
  "receivedAmount": 0.00578388,
  "feePct": 0.21,
  "signature": "4xK2...9zH1"
}
```

### JLP loans: borrow USDC against JLP

One loan per wallet: JLP is the collateral, USDC is borrowed. Transactions are sent straight to Solana through your RPC.

```bash
jup perps loans info
jup perps loans positions [--key <name> | --address <wallet>]
jup perps loans history [--key <name> | --address <wallet>] [--limit 20]

# Deposit JLP and borrow USDC (either option alone also works)
jup perps loans borrow --deposit 100 --amount 200

# Repay USDC and/or withdraw JLP ('max' repays everything / withdraws the most allowed)
jup perps loans repay --amount 50
jup perps loans repay --amount max --withdraw max
```

- Amounts are in token units: `--deposit`/`--withdraw` in JLP, `--amount` in USDC.
- The loan is liquidated when LTV reaches `liquidationLtvPct`; `liquidationPriceUsd` is the JLP price at which that happens.

```js
// Example JSON response (info):
{
  "jlpPriceUsd": 4.8358,
  "borrowAprPct": 5.83,
  "availableLiquidityUsd": 68082711.03, // USDC available to borrow
  "totalSupplyUsd": 275401550.25,
  "utilizationPct": 61.75,
  "maxLtvPct": 90, // max loan-to-value when borrowing
  "liquidationLtvPct": 95,
  "liquidationPenaltyPct": 2
}

// Example JSON response (positions):
{
  "positions": [
    {
      "positionPubkey": "QeVn...7Bm",
      "collateralAmount": 150000, // JLP
      "collateralUsd": 725396.03,
      "debtAmount": 445409.45, // USDC owed
      "ltvPct": 61.4,
      "liquidationPriceUsd": 3.1257, // JLP price that triggers liquidation
      "maxBorrowAmount": 206141.25, // more USDC you can borrow
      "maxRepayAmount": 449873.47, // USDC that fully repays the loan
      "maxWithdrawAmount": 47567.59 // JLP you can withdraw now
    }
  ]
}

// Example JSON response (history):
{
  "count": 12,
  "history": [
    {
      "time": "2026-10-01T08:22:21.000Z",
      "type": "Repay", // DepositCollateral, WithdrawCollateral, Borrow, Repay, Liquidation
      "amount": 100008.44,
      "token": "USDC",
      "signature": "4AYu...gAYd8"
    }
  ]
}

// Example JSON response (borrow; repay has repaidAmount/withdrawnAmount instead):
{
  "action": "loan-borrow", // or "loan-repay"
  "depositedAmount": "10", // null if not depositing
  "borrowedAmount": "5", // null if not borrowing
  "positionPubkey": "EWUW...C6Ud",
  "collateralAmount": 10, // JLP after this change
  "debtAmount": 5, // USDC owed after this change
  "ltvPct": 10.33,
  "liquidationPriceUsd": 0.5263,
  "signature": "5YhT...9AKU"
}
```

## Workflows

### Open a position with TP/SL

```bash
jup perps open --asset SOL --side long --amount 10 --input USDC --leverage 3 --tp 100 --sl 70
```

### Check positions then close

```bash
jup perps positions
# Copy the positionPubkey
jup perps close --position <pubkey>
```

### Add TP/SL to an existing position

```bash
jup perps positions
# Copy the positionPubkey
jup perps set --position <pubkey> --tp 100 --sl 70
```

### Place a limit order then update it

```bash
jup perps open --asset BTC --side long --amount 10 --input USDC --leverage 2 --limit 65000
jup perps positions
# Copy the orderPubkey
jup perps set --order <pubkey> --limit 64000
```

### Review recent trades

```bash
jup perps history --asset SOL --limit 10
```

### Add collateral to reduce leverage

```bash
jup perps positions
# Copy the positionPubkey
jup perps set --position <pubkey> --add-collateral 10 --input USDC
```
