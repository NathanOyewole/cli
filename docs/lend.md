# Lending

Requires: an active key for write commands. See [setup](setup.md).

Jupiter Lend has two markets: `main` (default) and `ethena` (Ethena x Bitwise, jle* tokens). Every `lend` command accepts `--market main|ethena`.

Write commands build the transaction from Jupiter Lend instructions (`lite-api.jup.ag/lend/v1`), sign it locally and send it to your RPC (`jup config set --rpc-url <url>`). `--dry-run` returns the unsigned base64 `transaction` instead.

## Earn

### View available tokens

```bash
jup lend earn tokens
jup lend earn tokens --market ethena
```

- Shows all tokens available for lending with APY, TVL, and withdrawable liquidity

```js
// Example JSON response:
{
  "tokens": [
    {
      "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 }, // underlying token
      "jlToken": { "id": "jl1U...xxx", "symbol": "jlUSDC", "decimals": 6 }, // lending token
      "apyPct": 5.97, // total APY; 5.97 means 5.97%
      "supplyApyPct": 4.50, // supply rate portion
      "rewardsApyPct": 1.47, // rewards rate portion
      "totalTvlUsd": 125000000, // total TVL in USD
      "withdrawableUsd": 80000000, // available withdrawable liquidity in USD
      "priceUsd": 1.00 // underlying token price
    }
  ]
}
```

### View positions

```bash
jup lend earn positions
jup lend earn positions --key mykey
jup lend earn positions --address <wallet-address>
jup lend earn positions --token USDC
jup lend earn positions --market ethena
```

- With no options, uses the active key's wallet
- `--address` looks up any wallet without needing a key
- `--token` filters by underlying token (symbol or mint address)

```js
// Example JSON response:
{
  "positions": [
    {
      "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 }, // underlying token
      "jlToken": { "id": "jl1U...xxx", "symbol": "jlUSDC", "decimals": 6 }, // derivative token
      "positionAmount": 1025.30, // current position value in underlying token units, including earnings
      "positionUsd": 1025.30, // current position value in USD
      "earningsAmount": 24.80, // accrued interest in underlying token units
      "earningsUsd": 24.80, // accrued interest in USD
      "apyPct": 5.97 // current APY; 5.97 means 5.97%
    }
  ]
}
```

### Deposit

```bash
jup lend earn deposit --token USDC --amount 100
jup lend earn deposit --token SOL --amount 1.5 --key mykey
jup lend earn deposit --token USDC --raw-amount 100000000
jup lend earn deposit --token USDC --amount 100 --dry-run
jup lend earn deposit --market ethena --token PYUSD --amount 100
```

- Deposits directly into the lending pool (no swap). Native SOL is wrapped and unwrapped in the same transaction.
- `--token` (required) — underlying token to deposit (symbol or mint address; `SOL` means WSOL)
- `--amount` uses human-readable units (e.g. `100` USDC = 100 USDC)
- `--raw-amount` uses on-chain units (e.g. `100000000` = 100 USDC)
- Exactly one of `--amount` or `--raw-amount` is required
- `--key` overrides the active key for this transaction
- `--dry-run` previews the deposit without signing. JSON response includes the unsigned base64 `transaction`.

```js
// Example JSON response:
{
  "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "depositedAmount": "100", // human-readable amount just deposited
  "depositedUsd": 100.00, // USD value of deposit
  "positionAmount": 1125.30, // total position after deposit
  "positionUsd": 1125.30, // total position USD value
  "apyPct": 5.97, // current APY; 5.97 means 5.97%
  "signature": "3dV9...8zG1" // tx signature
}
```

### Withdraw

```bash
jup lend earn withdraw --token USDC --amount 50
jup lend earn withdraw --token USDC                   # withdraw entire position
jup lend earn withdraw --token jlUSDC --amount 50     # also accepts jlToken directly
jup lend earn withdraw --token USDC --raw-amount 50000000
jup lend earn withdraw --token USDC --amount 50 --dry-run
```

- `--token` (required) — token to withdraw (accepts underlying symbol/address or jlToken symbol/address)
- `--amount` in human-readable units of the underlying token
- `--raw-amount` in on-chain units of the jlToken (redeems that many shares)
- When neither `--amount` nor `--raw-amount` is provided, redeems the entire position
- Fails early when the amount exceeds the pool's currently withdrawable liquidity (protocol withdrawal limit)
- `--key` overrides the active key for this transaction
- `--dry-run` previews the withdrawal without signing. JSON response includes the unsigned base64 `transaction`.

```js
// Example JSON response:
{
  "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "withdrawnAmount": "50", // human-readable amount just withdrawn
  "withdrawnUsd": 50.00, // USD value of withdrawal
  "positionAmount": 975.30, // remaining position after withdrawal (0 if fully withdrawn)
  "positionUsd": 975.30, // remaining position USD value
  "apyPct": 5.97, // current APY; 5.97 means 5.97%
  "signature": "5YhT...9AKU" // tx signature
}
```

### History

```bash
jup lend earn history
jup lend earn history --address <wallet-address> --token USDC --type deposit
jup lend earn history --page 2
```

- `--type` filters by `deposit`, `withdraw`, `transfer`, `mint` or `redeem`
- 10 entries per page; use `next` from the response as the next `--page`

```js
// Example JSON response:
{
  "count": 59, // total entries
  "history": [
    {
      "time": "2026-09-30T14:01:40.000+00:00",
      "type": "deposit",
      "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
      "amount": 360000.0015, // underlying token units
      "amountUsd": 359947.33, // USD value at the time; null if unknown
      "status": "success",
      "signature": "5zeF...VVAp"
    }
  ],
  "next": 2 // next page; omitted on the last page
}
```

### APY chart

```bash
jup lend earn chart --token USDC
jup lend earn chart --token USDC --range 30d
```

- `--range` is `1d`, `7d` (default), `30d` or `1y`
- APYs are annualized from the change in exchange price between points, as on jup.ag

```js
// Example JSON response:
{
  "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
  "range": "7d",
  "points": [
    {
      "time": "2026-09-30T08:00:00.000Z",
      "apyPct": 6.23, // total APY including rewards
      "baseApyPct": 5.84, // supply APY only
      "exchangeRate": 1.062274 // underlying tokens per jlToken
    }
  ]
}
```

## Borrow

Vaults pair one collateral token with one debt token. A position is an NFT identified by `positionId` (unique within its vault). Position commands look the vault up from the signer's positions; pass `--vault` when the position belongs to another wallet or the ID exists in several vaults.

### Vaults

```bash
jup lend borrow vaults
jup lend borrow vaults --multiply   # only vaults that support Multiply
jup lend borrow vaults --smart      # only smart (DEX) vaults
jup lend borrow vault --vault 1     # one vault with oracle price, limits and fees
```

```js
// Example JSON response (vaults):
{
  "vaults": [
    {
      "vaultId": 1,
      "collateral": { "id": "So11...1112", "symbol": "WSOL", "decimals": 9 },
      "debt": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
      "type": "normal", // or "smart" (DEX vault, read-only in the CLI)
      "supplyApyPct": 4.05, // includes LST staking yield and rewards
      "borrowApyPct": 5.36,
      "maxLtvPct": 80, // max LTV when borrowing
      "liquidationLtvPct": 85,
      "liquidationPenaltyPct": 1,
      "maxMultiplier": 4.85, // max Multiply leverage
      "multiply": true,
      "totalSupplyUsd": 208260731.91, // null for smart sides
      "totalBorrowUsd": 64393702.06,
      "borrowableUsd": 16098409.03,
      "positions": 10065
    }
  ]
}
```

`vault` adds `address`, `oraclePrice` (debt tokens per collateral token), `borrowFeePct`, `minimumBorrow`, `pegged` and `strategy`.

### Positions

```bash
jup lend borrow positions
jup lend borrow positions --address <wallet-address>
jup lend borrow positions --vault 1 --position 10062
```

```js
// Example JSON response:
{
  "positions": [
    {
      "positionId": 10062,
      "vaultId": 1,
      "positionAddress": "CSrW...BLjD", // position NFT mint
      "collateral": {
        "token": { "id": "So11...1112", "symbol": "WSOL", "decimals": 9 },
        "amount": 214.004, // smart sides are in 9-decimal DEX shares
        "amountUsd": 25254.93 // null for smart sides
      },
      "debt": {
        "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
        "amount": 7146.967,
        "amountUsd": 7145.71
      },
      "netValueUsd": 18109.22,
      "ltvPct": 28.31, // current LTV
      "maxLtvPct": 80,
      "liquidationLtvPct": 85, // liquidated at this LTV
      "liquidationPrice": 39.29, // collateral price (in debt tokens) at which it liquidates; null without debt
      "healthStatus": "Safe", // Safe, Medium, Risky, Very Risky or Liquidated
      "multiplier": 1.39, // effective leverage
      "supplyApyPct": 4.05,
      "borrowApyPct": 5.36,
      "netApyPct": 3.53, // APY on net value
      "pnlUsd": 112.04, // null if unavailable
      "pnlPct": 0.62,
      "strategy": false // opened as a max-leverage strategy
    }
  ]
}
```

### History and liquidations

```bash
jup lend borrow history --position 10062
jup lend borrow history --position 10062 --vault 1 --page 2
jup lend borrow liquidations --position 10062 --vault 1
```

- `history` returns `{ vaultId, positionId, count, history: [{ time, type, collateralChange, collateralChangeUsd, debtChange, debtChangeUsd, status, signature }], next }`; `type` is `deposit`, `borrow`, `withdraw`, `payback`, `deposit-borrow`, `payback-withdraw`, `multiply`, `unwind` or `unwind-withdraw`
- `liquidations` returns `{ vaultId, positionId, count, liquidations: [{ time, collateralAmount, debtAmount, oraclePrice, signature }], next }`

### Open, deposit, borrow, repay, withdraw, close

```bash
jup lend borrow open --vault 1 --collateral 2 --borrow 100
jup lend borrow deposit --position 10062 --amount 1
jup lend borrow borrow --position 10062 --amount 50
jup lend borrow repay --position 10062 --amount 50
jup lend borrow repay --position 10062            # repay all debt
jup lend borrow withdraw --position 10062 --amount 1
jup lend borrow withdraw --position 10062         # withdraw all collateral
jup lend borrow operate --position 10062 --deposit 1 --borrow 50
jup lend borrow operate --position 10062 --repay max --withdraw 0.5
jup lend borrow close --position 10062            # repay all and withdraw all
```

- Amounts are in human-readable units of the collateral or debt token. Native SOL is wrapped and unwrapped automatically.
- `operate` combines one collateral change (`--deposit` or `--withdraw`) with one debt change (`--borrow` or `--repay`) in a single transaction; `--withdraw` and `--repay` accept `max`
- Full repay budgets an hour of interest; any excess stays in your wallet
- Rejected before building when the resulting LTV exceeds the vault's max LTV, the borrow is below the vault minimum, or the vault lacks borrowable/withdrawable liquidity
- Smart (DEX) vaults are read-only in the CLI

```js
// Example JSON response (with --dry-run):
{
  "dryRun": true,
  "action": "open", // open, deposit, borrow, repay, withdraw, operate or close
  "vaultId": 1,
  "positionId": 10065, // the new position for `open`
  "collateral": {
    "token": { "id": "So11...1112", "symbol": "WSOL", "decimals": 9 },
    "change": 0.1, // signed change
    "amount": 0.1 // collateral after the transaction
  },
  "debt": {
    "token": { "id": "EPjF...USDC", "symbol": "USDC", "decimals": 6 },
    "change": 5,
    "amount": 5
  },
  "ltvPct": 42.39, // LTV after the transaction
  "maxLtvPct": 80,
  "liquidationLtvPct": 85,
  "liquidationPrice": 58.82,
  "healthStatus": "Safe", // null when no debt remains
  "signature": null, // tx signature when not a dry run
  "transaction": "AQAA..." // unsigned base64 transaction (dry run only)
}
```

## Multiply

Multiply builds leverage in one transaction: flashloan the debt token, swap it into collateral (Jupiter swap API), deposit and borrow, then repay the flashloan. Deleveraging runs the reverse.

```bash
jup lend multiply vaults
jup lend multiply open --vault 4 --amount 1 --leverage 3
jup lend multiply set --position 10062 --leverage 2    # lever up or down
jup lend multiply close --position 10062               # sell collateral to repay all debt
jup lend multiply open --vault 4 --amount 1 --leverage 3 --slippage 20
```

- `--amount` is the margin, in the collateral token; `--leverage` is between 1 and the vault's `maxMultiplier`
- `--slippage` is in basis points (default 10)
- If a vault's swap route is too large to open and lever in one transaction, `open` asks you to `jup lend borrow open` first and then `multiply set`
- Smart Multiply (smart vaults) is not supported
- The response has the same shape as the borrow commands plus `leverage` (after) and `swap: { inputMint, outputMint, inAmount, minOutAmount, route, slippageBps }`

## Markets, statistics and tools

```bash
jup lend markets                                      # main and Ethena markets with TVL
jup lend stats earn [--market ethena]                 # total supply, lifetime earnings, per-token supply
jup lend stats borrow                                 # total collateral and debt, top vaults
jup lend stats liquidity                              # liquidity layer supply/borrow, APYs, utilization
jup lend stats dex                                    # smart vault DEX pools: 7d volume, fees, swaps
jup lend stats positions --vault 1 --sort borrow      # all borrow positions; also --address, --liquidated, --page
jup lend strategies                                   # max-leverage strategy vaults with max APY
jup lend calculator --vault 4 --leverage 5            # days to liquidation (pegged vaults)
jup lend transparency [--market ethena]               # multisigs, audits, oracles, risk reports
```

- `calculator` returns `{ vaultId, leverage, maxMultiplier, ltvPct, liquidationLtvPct, supplyApyPct, netApyPct, scenarios: [{ scenario, borrowApyPct, daysToLiquidation }] }`; scenarios `standard`, `moderate` and `max` use 1x, 2x and 3x the current borrow APY, and `daysToLiquidation` is `null` when supply yield outpaces borrow cost
- `stats positions` sorts by `healthFactor`, `ratio`, `updatedAt` (default), `supply` or `borrow`
- Refinance (migrating Kamino/Marginfi/Save positions) is not available: it needs an internal Jupiter API

## Workflows

### Check available tokens then deposit

```bash
jup lend earn tokens
# Pick a token with good APY
jup lend earn deposit --token USDC --amount 100
```

### Check positions then withdraw

```bash
jup lend earn positions
# Review current value and earnings
jup lend earn withdraw --token USDC --amount 50
```

### Withdraw entire position

```bash
jup lend earn withdraw --token USDC
```
