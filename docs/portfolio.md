# Portfolio

Net worth, positions across protocols, spot PnL and airdrops, for one wallet or a group of wallets. No command sends transactions; only the address book writes (to a local file).

## Choosing wallets

`--address` takes a comma-separated list of any of:

- **Wallet addresses**, e.g. `--address 5tz...,BQ7...`
- **Address book names**: saved wallets and groups (see [address book](#address-book))
- **Built-in demo wallets** from jup.ag/portfolio: `defi-whale`, `jup-staker`, `airdrop-farmer`, and the group `demo` with all three

Up to 15 wallets can be viewed together. With no `--address`, the active key's wallet is used; `--key` picks another key. `--key` and `--address` are mutually exclusive.

## Commands

### Positions and net worth

```bash
jup portfolio positions
jup portfolio positions --address <wallet-address>
jup portfolio positions --address demo
jup portfolio positions --address alice,bob
```

- Lists wallet tokens and DeFi positions (lending, borrowing, vaults, LPs, limit and DCA orders, perps, prediction markets, staking, vesting), with net worth per wallet and in total
- `coverage` tells you what was scanned:
  - `jupiter-platforms` (default): the public Portfolio API covers Jupiter products. The CLI adds wallet tokens and staked JUP.
  - `all-platforms`: used when your API key (`jup config set --api-key`) has Portfolio v2 access. It covers every protocol the jup.ag portfolio shows.
- Borrowed assets have `role: "borrowed"`; a position's `valueUsd` is net of debt
- `failedFetchers` lists sources the API could not load this time

```js
// Example JSON response:
{
  "coverage": "jupiter-platforms",
  "netWorthUsd": 724.51,
  "wallets": [
    {
      "address": "jupE...H5H",
      "netWorthUsd": 724.51,
      "failedFetchers": []
    }
  ],
  "positions": [
    {
      "owner": "jupE...H5H",
      "platformId": "jupiter-exchange",
      "label": "Lending", // Wallet, Staked, Lending, Vault, LiquidityPool, LimitOrder, DCA, Leverage, Deposit, Vesting, ...
      "name": null,
      "type": "borrowlend", // multiple | liquidity | borrowlend | trade | leverage
      "valueUsd": 26.33,
      "apyPct": 15.63, // net APY; null when not reported
      "healthRatio": 0.36, // borrowlend only
      "assets": [
        {
          "role": "supplied", // asset | supplied | borrowed | reward | collateral | input | output
          "mint": "27G8...idD4",
          "symbol": "JLP",
          "amount": 12.808648,
          "priceUsd": 4.83,
          "valueUsd": 61.84
        },
        {
          "role": "borrowed",
          "mint": "EPjF...USDC",
          "symbol": "USDC",
          "amount": 35.514546,
          "priceUsd": 1,
          "valueUsd": 35.51
        }
      ],
      "perps": [], // leverage positions: side, mint, symbol, size, sizeUsd, pnlUsd, leverage, entryPriceUsd, markPriceUsd, liquidationPriceUsd, valueUsd
      "link": "https://jup.ag/lend/borrow/8/nfts/7170"
    }
  ]
}
```

### Spot PnL

```bash
jup portfolio pnl
jup portfolio pnl --address <wallet-address>
```

- Trading PnL for one wallet over `1d`, `7d`, `30d` and `total`, plus PnL of each token still held
- Like jup.ag, PnL is per wallet: a group is rejected

```js
// Example JSON response:
{
  "address": "jupE...H5H",
  "stats": {
    "total": {
      "pnlUsd": -10.05,
      "realizedPnlUsd": -7.52,
      "unrealizedPnlUsd": -2.53,
      "pnlPct": -4.13, // -4.13 means -4.13%
      "winRatePct": 50,
      "buys": 16,
      "sells": 12,
      "boughtVolumeUsd": 1385.55,
      "soldVolumeUsd": 178.58
    }
    // "1d", "7d", "30d" have the same shape
  },
  "tokens": [
    {
      "mint": "7GxA...otXk",
      "symbol": "jlUSDC",
      "balance": 7.371107,
      "valueUsd": 7.66,
      "averageCostUsd": 1.0058,
      "realizedPnlUsd": 0.12,
      "unrealizedPnlUsd": 0.25,
      "pnlUsd": 0.37,
      "pnlPct": 1.7
    }
  ]
}
```

For swap-by-swap history use `jup spot history`.

### Airdrop checker

```bash
jup portfolio airdrops
jup portfolio airdrops --address alice,bob
jup portfolio airdrops --address airdrop-farmer --all
```

- Lists airdrops the wallets are eligible for; `--all` adds ineligible ones
- Claiming happens on each project's site: open `claimLink`
- Requires an API key with Portfolio v2 access (`jup config set --api-key <key>`). Without one the command fails with a clear error.

```js
// Example JSON response:
{
  "claimableValueUsd": 0, // sum of items with status "claimable"
  "airdrops": [
    {
      "owner": "tEsT...51nd",
      "id": "switchboard-airdrop",
      "name": "Switchboard",
      "status": "closed", // notYetOpen | unknown | open | closed
      "claimStart": "2025-09-09T12:00:00.000Z",
      "claimEnd": "2025-10-09T12:00:00.000Z",
      "claimLink": "https://claim.switchboard.foundation/",
      "valueUsd": 0.0095,
      "items": [
        {
          "mint": "SW1T...TbFx",
          "symbol": "SWITCH",
          "amount": 200,
          "valueUsd": 0.0095,
          "status": "claimExpired" // claimable | claimableLater | potentiallyClaimable | claimed | claimExpired | ineligible | partiallyClaimed
        }
      ]
    }
  ]
}
```

## Address book

Saved wallets and groups live in `~/.config/jup/addressbook.json` and can be used anywhere `--address` takes a list. Names are unique across wallets and groups.

```bash
jup portfolio addressbook list
jup portfolio addressbook add --name alice --address <wallet-address>
jup portfolio addressbook add --name bob --address <wallet-address> --group team
jup portfolio addressbook remove --name bob --group team   # remove from the group only
jup portfolio addressbook remove --name bob                # remove the wallet everywhere
jup portfolio addressbook remove --name team               # remove the group
```

- Names may contain letters, digits, `.`, `_` and `-`; they cannot be a Solana address or a built-in demo name (`defi-whale`, `jup-staker`, `airdrop-farmer`, `demo`)
- `add` validates the address. Re-adding a name with the same address is a no-op; a name already used for a different address or for a group is rejected. `--group` cannot name an existing wallet.
- A group is created when its first wallet is added and removed when it becomes empty. A group holds at most 15 wallets.
- `remove --name` accepts a wallet name or a group name; with `--group`, `--name` may also be a raw wallet address
- `add` and `remove` print the updated book (JSON: `wallets` and `groups` only, without `builtIn`; table: the same view as `list`)

```js
// Example JSON response (list):
{
  "wallets": [{ "name": "alice", "address": "5tz...Ai9" }],
  "groups": [{ "name": "team", "addresses": ["5tz...Ai9"] }],
  "builtIn": {
    "wallets": [{ "name": "defi-whale", "address": "Demo...tKG" }],
    "groups": [{ "name": "demo", "addresses": ["Demo...tKG", "jupE...H5H", "tEsT...51nd"] }]
  }
}
```

## Workflows

### Track a group of wallets

```bash
jup portfolio addressbook add --name main --address <address-1> --group mine
jup portfolio addressbook add --name trading --address <address-2> --group mine
jup portfolio positions --address mine
```
