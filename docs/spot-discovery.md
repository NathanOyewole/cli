# Spot Discovery & Token Data

Market lists, the AlphaScan screener, sectors, launchpads, Smart Money, token detail pages, and local watchlists and wallet tracking. These are the same data sources as jup.ag/spot.

Requires: nothing, and no key. Commands only read market data; `watchlist` and `tracker` commands also edit local files. `spot token news` and the AI summary in `spot token about` need an API key (`jup config set --api-key <key>`).

Conventions: USD amounts end in `Usd` (`priceUsd`, `volumeUsd`, `pnlUsd`), except `mcap`, `fdv` and `liquidity`, which are also USD. Percentages end in `Pct` and are plain numbers (`5.97` means +5.97%). Missing values are `null`. Times are ISO 8601 strings.

## Token lists

```bash
jup spot tokens --list trending
jup spot tokens --list trending --interval 1h --limit 50
jup spot tokens --list toptraded --interval 5m --sort volume
jup spot tokens --list stablecoins --interval 30d --only-yb
jup spot tokens --list meme --sort mcap --sort-dir desc
jup spot tokens --list popular --offset 20
jup spot tokens --list toptraded --launchpad pump.fun --min-mcap 1000000
```

- `--list`: `trending`, `popular`, `toptraded`, `organic`, `recent` (newest tokens), `stocks` (tokenized stocks), `stablecoins`, `runners` (launchpad runners), and the sectors `meme`, `defi`, `yield`, `rwa`
- `--interval`: `5m`, `1h`, `6h`, `24h` (default). `stablecoins` also accepts `7d` and `30d` (default `30d`)
- `--sort`: one of `usdPrice`, `vwap`, `liquidity`, `mcap`, `fdv`, `listedTime`, `holderCount`, `organicScore`, `bondingCurve`, `graduatedAt`, `stockData.price`, `stockData.mcap`, `stockData.priceChange24h`, `priceDelta`, `feesPaid`, `symbol`, `priceChange`, `txs`, `netTxs`, `traders`, `numNetBuyers`, `volume`, `netVolume`, `holderChange`, `numOrganicBuyers`, `organicVolume`, `netOrganicVolume`, `apy`. Defaults to the order jup.ag uses for that list: `netVolume` for `trending`, `numOrganicBuyers` for `organic`, `mcap` for `runners`, `volume` for `toptraded`, `stocks`, `stablecoins` and the sectors, and the server order for `popular` and `recent`. `--sort-dir` is `asc` or `desc` (default)
- `--limit` defaults to 20; `--offset` pages through results using the `next` value
- `recent` does not support `--sort` or `--offset`, and its `total` and `next` are always `null`
- `--list` and `--search` are mutually exclusive, and `--interval`, `--sort`, `--offset` and filters are errors without `--list`
- Screener filters (see [Filters](#filters)) narrow any list

```js
{
  "list": "trending",
  "interval": "1h",
  "total": 120, // null when the list does not report a total
  "next": 20, // offset for the next page; null on the last page
  "tokens": [
    {
      "rank": 1,
      "id": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      "symbol": "JUP",
      "name": "Jupiter",
      "priceUsd": 0.329,
      "priceChangePct": -0.55, // over --interval
      "mcap": 1092465870.59,
      "liquidity": 5940700.3,
      "volumeUsd": 358040.12, // buy + sell volume over --interval
      "netVolumeUsd": 25200.4, // buy - sell volume
      "txns": 3010,
      "traders": 640,
      "netBuyers": 12,
      "holderCount": 839218,
      "organicScore": 98.7,
      "organicScoreLabel": "high",
      "isVerified": true,
      "launchpad": null,
      "createdAt": "2024-01-29T17:33:29Z" // first pool creation
    }
  ]
}
```

### Filters

`spot tokens --list` and `spot alphascan` accept the jup.ag screener filters. Volume, net volume, transaction, buy, sell and net-buyer filters apply to `--interval`.

- Flags: `--verified`, `--mint-authority-disabled`, `--freeze-authority-disabled`, `--icon-reused`, `--small-meteora-dbc`, `--has-socials`, `--is-pump-live`, `--only-cto`, `--only-dex-paid`, `--only-dex-boost`, `--only-dev-sold`, `--only-dev-holding`, `--only-stable`, `--only-yb`
- Min/max pairs, e.g. `--min-mcap <n>` and `--max-mcap <n>`: `mcap`, `liquidity`, `volume`, `net-volume`, `txns`, `buys`, `sells`, `num-net-buyers`, `holder-count`, `organic-score`, `bonding-curve`, `token-age` (minutes), `bonded-age` (minutes), `fees`, `top-holders-percentage`, `dev-balance-pct`, `dev-migrations`, `sniper-pct`, `insider-pct`, `bundler-pct`, `bot-holders-percentage`, `bot-holders-count`, `twitter-followers`, `twitter-following`, `twitter-reuse-count`, `tweet-age-sec`
- Single values: `--lp-burnt-percentage <n>` (minimum LP burnt %), `--top-holders-percentage <n>` (maximum top-10 holders %), `--num-of-socials <n>` (minimum number of social links)
- Lists (comma-separated): `--launchpad pump.fun,met-dbc`, `--twitter-handles <list>` (max 10), `--search-include <words>` and `--search-exclude <words>` (max 5)

## Stocks

```bash
jup spot stocks
jup spot stocks --type ETF --sort volume --limit 50
jup spot stocks --symbol NVDA,AAPL
```

- `--sort`: `mcap` (default), `price`, `priceChange24h`, `volume`. `--sort-dir` is `asc` or `desc` (default)
- `--type`: `CS`, `ETF`, `ADRC`, `ETN`, `ETV`, `PFD` (comma-separated)
- `--sector` (comma-separated), `--symbol` (comma-separated tickers), `--limit` (default 20), `--offset` (use `next`)

```js
{
  "total": 1381,
  "next": 20, // null on the last page
  "stocks": [
    {
      "symbol": "NVDA",
      "name": "Nvidia Corp",
      "type": "CS",
      "sector": "Technology",
      "exchange": "NASDAQ",
      "priceUsd": 229.72,
      "priceChangePct": 1.1, // 24h
      "mcap": 5486439870000,
      "volumeUsd": 27956187053.74,
      "marketState": null,
      "tokens": [
        { "issuer": "xstocks", "mint": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" }
      ]
    }
  ]
}
```

## Market overview

```bash
jup spot pulse
jup spot heatmap
jup spot heatmap --category meme --sort volume --limit 10
jup spot categories
jup spot categories --category defi
```

- `pulse` returns the latest AI market brief: `generatedAt`, `summary`, `details`, `sources`, per-sector `sectors[]` (`category`, `summary`, `details`, `tokens[]` of `{ id, symbol }`), and `spotlight[]` (24h token rows with live prices, as in Token lists). The `spotlight` sector also appears in `sectors[]`
- `heatmap` returns `timestamp` and `categories[]` with `description`, `mcap`, `dominancePct`, `mcapChangePct` (24h), `topMovers[]` (`id`, `symbol`, `name`, `priceChangePct`) and `assets[]` (`id`, `symbol`, `volumeUsd`, `priceChangePct`). `--category`: `meme`, `defi`, `yield`, `rwa` (default: all sectors). `--sort mcap|volume` (default `mcap`) ranks the assets and `--limit` sets assets per sector (default 20). For `rwa`, asset `id` is the stock ticker
- `categories` returns `categories[]` with `description`, `mcap`, `mcapChange1hPct`, `mcapChange24hPct`, `mcapChange7dPct`, `volume24hUsd`, `netVolume24hUsd` and `topMovers[]`. `--category` takes the same sectors. A sector's tokens: `jup spot tokens --list meme`

## AlphaScan

```bash
jup spot alphascan
jup spot alphascan --tab graduating --limit 30
jup spot alphascan --tab new --launchpad pump.fun --min-mcap 20000 --max-dev-balance-pct 5
```

- `--tab`: `new`, `graduating`, `graduated` (default: all three). The JSON only has the columns you ask for
- `--limit` per column: default 10, max 30 (higher is an error). `--interval` is `5m`, `1h`, `6h` or `24h` (default) and applies to volume filters

```js
{
  "interval": "24h",
  "new": [
    {
      // ...token row fields (see Token lists), plus:
      "bondingCurvePct": 84.8,
      "graduatedAt": null,
      "devBalancePct": 0.36,
      "topHoldersPct": 2.36,
      "sniperPct": 0.16,
      "insiderPct": null,
      "bundlerPct": null,
      "twitter": null
    }
  ],
  "graduating": [],
  "graduated": []
}
```

## Launchpads

```bash
jup spot launchpads
jup spot launchpads --interval 7d --sort volume
jup spot launchpads --launchpad bags.fun
```

- `--interval`: `1d` (default), `7d`, `30d`. `--sort`: `marketShare` (default), `volume`, `traders`, `runners`, `mints`, `graduates`, `bondedRate`
- `--launchpad <id>` shows a single launchpad (case-insensitive; errors if not found), keeping its `rank` from the full leaderboard. `--limit` defaults to 20
- A launchpad's tokens: `jup spot tokens --list toptraded --launchpad <id>`, `jup spot tokens --list runners --launchpad <id>`, `jup spot alphascan --tab new --launchpad <id>`

```js
{
  "interval": "1d",
  "launchpads": [
    {
      "rank": 1,
      "launchpad": "pump.fun",
      "marketSharePct": 74.99,
      "volumeUsd": 632249623.96,
      "traders": 656158,
      "runners": 1,
      "mints": 45522,
      "graduates": 1271,
      "bondedRatePct": 2.79, // graduates / mints; null with no mints
      "newMarketSharePct": 84.0, // tokens launched in the window
      "newVolumeUsd": 463676742.64,
      "newTraders": 501423
    }
  ]
}
```

## Smart Money

```bash
jup spot smart-money wallets
jup spot smart-money wallets --category whales --interval 7d --limit 100
jup spot smart-money trades
jup spot smart-money summary --side buy
```

- `wallets --category`: `influencers` (default), `smart`, `whales`, `top-pnl`. `--interval`: `1d` (default), `7d`, `30d`. `--limit` defaults to 20
- `trades` lists the latest Smart Money trades grouped by token (`--limit` defaults to 5). `summary --side buy|sell` (default `buy`) lists the tokens Smart Money is buying or selling most (`--limit` defaults to 20)
- Follow a wallet with `jup spot tracker add --address <address>`

```js
// wallets
{
  "category": "influencers",
  "interval": "1d",
  "wallets": [
    {
      "rank": 1,
      "address": "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue",
      "twitter": null,
      "pnlUsd": 115736.49,
      "winRatePct": 90.9,
      "volumeUsd": 210708072.52,
      "txns": 11,
      "lastActiveAt": "2026-09-30T14:09:40Z"
    }
  ]
}
// trades: { "trades": [{ "token": { "id", "symbol" }, "side", "majoritySide", "latestAt", "traders", "volumeUsd", "soldPct", "wallets": [...] }] }
// summary: { "side": "buy", "tokens": [{ "id", "symbol", "traders", "volumeUsd", "latestAt", "wallets": [...] }] }
// wallets[] in trades and summary: { "address", "twitter", "categories", "side", "volumeUsd", "latestAt", "pnl7dUsd", "volume7dUsd", "winRate7dPct" }
```

## Token detail

Every `spot token` subcommand takes `--token <symbol-or-mint>`.

```bash
jup spot token info --token JUP
jup spot token chart --token JUP --interval 15m --candles 96
jup spot token chart --token JUP --type mcap --quote sol
jup spot token net-volume --token JUP --interval 1h
jup spot token holders --token JUP --limit 50
jup spot token holders --token <mint> --tag sniper
jup spot token traders --token JUP
jup spot token txs --token JUP --side buy --min-usd 1000
jup spot token txs --token <mint> --tag sniper,bundler --after 2026-01-01
jup spot token dev --token <mint>
jup spot token pools --token JUP
jup spot token about --token JUP
jup spot token news --token JUP
```

- `info`: price, market stats for 5m/1h/6h/24h, audit checklist, organic score and Jup Shield `warnings`
- `chart`: `--interval` `1s`, `15s`, `30s`, `1m`, `3m`, `5m`, `15m`, `30m`, `1h` (default), `2h`, `4h`, `8h`, `12h`, `1d`, `1w`, `1M`; `--candles` (default 24); `--type` `price` (default) or `mcap`; `--quote` `usd` (default), `sol`, or another token (needs `--interval` of 1m or more); `--before <date>` ends the window (default now). Candle prices and `volume` are in the quote currency
- `net-volume`: `--interval` `5m`, `1h`, `6h`, `24h` (default). Returns `points[]` of `{ time, netVolumeUsd }`
- `holders`: top holders with PnL, `--limit` default 20. `--tag` `sniper`, `insider`, `bundler`, `dev` (the token's dev wallet), or `tracked` (wallets in your tracker; errors if you follow none). `--address a,b` for specific wallets (ignored with `--tag dev` or `tracked`). `count` is the total holder count
- `traders`: top traders by PnL, `--limit` default 20. `--tag` `sniper`, `insider`, `bundler`
- `txs`: `--side buy|sell`, `--tag sniper,insider,bundler`, `--address a,b`, `--tracked`, `--dev`, `--min-usd`, `--max-usd`, `--after`, `--before`, `--limit` (default 20), `--offset <next>`. `--address`, `--tracked` and `--dev` combine into one wallet filter
- `dev`: the dev wallet's launch stats and its top tokens (`--limit` default 20). Errors if the token has no known dev wallet
- `pools`: liquidity pools for the token
- `about`: `description`, `narrative`, and `ai` (Jupiter Intel summary; `null` without an API key)
- `news`: Jupiter Intel news summary and items (`--limit` default 10, max 100). Requires an API key

```js
// info
{
  "id": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  "symbol": "JUP",
  "name": "Jupiter",
  "decimals": 6,
  "tokenProgram": "Tokenkeg...",
  "isVerified": true,
  "tags": ["verified"],
  "priceUsd": 0.329,
  "mcap": 1092465870.59,
  "fdv": 2258242239.24,
  "liquidity": 5940700.31,
  "holderCount": 839218,
  "circSupply": 3320000000,
  "totalSupply": 6863000000,
  "organicScore": 98.7,
  "organicScoreLabel": "high",
  "launchpad": null,
  "bondingCurvePct": null,
  "graduatedPool": null,
  "graduatedAt": null,
  "dev": "JUPhop9E8ZfdJ5FNHhxQt4uAih822Vs4QpqsWcewFbq",
  "createdAt": "2024-01-29T17:33:29Z",
  "firstPool": { "id": "Egcg...8cZk", "dex": "meteora", "createdAt": "2024-01-29T17:33:29Z" }, // null if unknown
  "socials": { "website": "https://jup.ag", "twitter": null, "telegram": null, "discord": null },
  "stats": {
    "24h": {
      "priceChangePct": 0.09,
      "volumeUsd": 16430000,
      "buyVolumeUsd": 8382000,
      "sellVolumeUsd": 8048000,
      "netVolumeUsd": 334260,
      "organicVolumeUsd": 952700,
      "txns": 154550,
      "buys": 80000,
      "sells": 74550,
      "traders": 13500,
      "netBuyers": 420,
      "organicBuyers": 95,
      "holderChangePct": 0.02,
      "liquidityChangePct": -0.3
    } // also "5m", "1h", "6h"
  },
  "audit": {
    "mintAuthorityDisabled": true,
    "freezeAuthorityDisabled": true,
    "topHoldersPct": 15.44,
    "devBalancePct": null,
    "devMigrations": null,
    "sniperPct": null,
    "insiderPct": null,
    "bundlerPct": 0.03,
    "botHoldersPct": null,
    "botHoldersCount": null,
    "lpBurnedPct": null,
    "iconReused": null,
    "impersonating": null // mint of the token this one impersonates
  },
  "warnings": [{ "type": "...", "severity": "warning", "message": "..." }]
}

// holders (traders returns { token, traders: [...] } with the same entries and no count)
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "count": 839218, // null when not reported
  "holders": [
    {
      "address": "EXJH...m6T",
      "amount": 1700000000.1,
      "valueUsd": 559501479.28,
      "supplyPct": 24.78,
      "solBalance": 4.26,
      "tags": ["Jupiter Community Hot Wallet"],
      "boughtUsd": null,
      "soldUsd": null,
      "realizedPnlUsd": null,
      "unrealizedPnlUsd": null,
      "pnlUsd": null,
      "pnlPct": null,
      "buys": null,
      "sells": null,
      "fundedBy": "Fg85...qF8",
      "lastActiveAt": null
    }
  ]
}

// txs
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "txs": [
    {
      "time": "2026-10-01T00:22:43.000Z",
      "side": "sell",
      "amount": 0.29,
      "priceUsd": 0.329,
      "valueUsd": 0.096,
      "solAmount": 0.0008,
      "trader": "BS1E...BXU",
      "traderTags": [], // sniper, insider, bundler
      "isMev": false,
      "poolId": "Egcg...8cZk",
      "signature": "4MGb...Z6"
    }
  ],
  "next": "452124572000104002" // pass to --offset; null on the last page
}

// chart (quote is "USD", "SOL" or the quote token's symbol)
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "interval": "1h",
  "type": "price",
  "quote": "USD",
  "candles": [
    { "time": "2026-10-01T00:00:00.000Z", "open": 0.33, "high": 0.331, "low": 0.327, "close": 0.329, "volume": 120000 }
  ]
}

// net-volume
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "interval": "24h",
  "points": [{ "time": "2026-10-01T00:00:00.000Z", "netVolumeUsd": 334260 }]
}

// dev
{
  "dev": "JUPhop...Fbq",
  "solBalance": 12.5,
  "numCreated": 4,
  "numCreatedInPast7Days": 0,
  "numMigrated": 2,
  "lastTokenLaunchedAt": "2024-01-29T17:33:29Z", // null if unknown
  "tokens": [] // token rows, as in Token lists
}

// pools
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "pools": [
    {
      "id": "Egcg...8cZk",
      "dex": "meteora",
      "type": "dlmm",
      "quoteToken": { "id": "So11...1112", "symbol": "SOL" }, // symbol null if unknown
      "liquidity": 1200000,
      "volume24hUsd": 3400000,
      "createdAt": "2024-01-29T17:33:29Z"
    }
  ]
}

// about
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "description": "...", // null if none
  "narrative": "...", // null if none
  "ai": {
    "status": "found", // also "none" or "pending" (status only), "copycat" (with original: { mint, symbol, name })
    "description": "...",
    "citations": ["https://example.com"],
    "updatedAt": "2026-10-01T00:00:00.000Z"
  } // null without an API key
}

// news
{
  "token": { "id": "JUPy...vCN", "symbol": "JUP" },
  "status": "found", // or "none", "pending"
  "summary": "...", // null unless status is "found"
  "items": [
    {
      "type": "tweet", // or "article"
      "source": "JupiterExchange", // tweet author or article publisher
      "title": null, // articles only
      "text": "...", // tweet text or article excerpt
      "url": "https://example.com",
      "publishedAt": "2026-10-01T00:00:00.000Z"
    }
  ]
}
```

## Watchlists

Watchlists are stored locally in `~/.config/jup/watchlist.json`. The file uses the same schema as the jup.ag web app's `intel_watchlist_config` localStorage value, so you can copy it between the two. A new file starts with the web's default list (SOL, JUP).

```bash
jup spot watchlist list
jup spot watchlist list --name memes --interval 1h
jup spot watchlist add --token BONK
jup spot watchlist add --stock NVDA --name stocks # creates the list
jup spot watchlist remove --token BONK
jup spot watchlist use --name memes # set the active list
jup spot watchlist delete --name memes
```

- `--name` defaults to the active list. At most 10 lists, names up to 15 characters. `add` creates a list that does not exist yet; `list` and `remove` need an existing one
- `list --interval`: `5m`, `1h`, `6h`, `24h` (default), the window for `priceChangePct`
- `add` and `remove` take exactly one of `--token <symbol-or-mint>` or `--stock <ticker>`. `remove` matches the entry by mint or symbol
- `use` and `delete` require `--name`. The only remaining list cannot be deleted; deleting the active list activates the first remaining one
- `add` and `remove` print `{ "watchlist", "added" | "removed", "entry" }` (the flag is `false` if the entry was already there or already gone). `use` prints `{ "activeWatchlist" }` and `delete` prints `{ "deleted", "activeWatchlist" }`

```js
// list
{
  "name": "Default",
  "active": true,
  "watchlists": ["Default", "memes"],
  "interval": "24h",
  "entries": [
    {
      "kind": "token", // or "stock"
      "id": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", // stocks: the stock slug
      "symbol": "JUP",
      "addedAt": "2026-10-01T00:16:59.207Z",
      "name": "Jupiter",
      "priceUsd": 0.329,
      "priceChangePct": -0.01, // stocks: 24h only, otherwise null
      "mcap": 1092465870.59,
      "liquidity": 5940700.31,
      "volumeUsd": 16430000
    }
  ]
}
```

## Wallet tracker

Followed wallets are stored locally in `~/.config/jup/tracker.json` as `{ following, labels }`, matching the web app's `pro_wallet_tracker_config.following` and `.labels` localStorage values. You can follow up to 50 wallets.

```bash
jup spot tracker list
jup spot tracker add --address <address> --name whale --emoji <emoji> --group smart,main
jup spot tracker remove --address <address>
jup spot tracker trades
jup spot tracker trades --token BONK --min-usd 1000 --limit 30
jup spot tracker import --file wallets.json
jup spot tracker export > wallets.json
```

- `add` on a wallet you already follow updates its label. `--name` is at most 18 characters; `--group` is comma-separated. Following a 51st wallet is an error
- `remove` errors if you are not following the address
- `trades`: latest trades by followed wallets (errors if you follow none). `--address a,b` narrows to those wallets; also `--token`, `--min-usd`, `--max-usd`, `--after`, `--before`, `--limit` (default 20, max 30), `--offset <next>`
- `import` reads the jup.ag "Share followed wallets" JSON, or Axiom, GMGN and Padre exports (`--file -` reads stdin). New wallets are added and labels merged; when over 50, the oldest are unfollowed. Entries without a valid address are skipped
- `export` prints the jup.ag / Axiom-compatible share JSON: an array of `{ address, name, emoji, alertsOnToast, alertsOnBubble, alertsOnFeed, groups, sound }`
- `add` prints `{ "following", "wallet" }` (`following` is the new count), `remove` prints `{ "following", "removed" }` (the removed address) and `import` prints `{ "imported", "added", "skipped", "unfollowed", "following" }`

```js
// list
{
  "wallets": [
    {
      "address": "48Jv5mJxqMehrGjtB2sUr2cTJAwvbEGx1jCFNJKGwaue",
      "name": "whale",
      "emoji": null,
      "groups": ["smart"],
      "addedAt": "2026-10-01T00:17:16.229Z",
      "solBalance": 1.26,
      "lastActiveAt": "2026-09-30T23:35:46.000Z"
    }
  ]
}

// trades
{
  "trades": [
    {
      "time": "2026-09-30T23:35:46.000Z",
      "wallet": { "address": "48Jv...waue", "name": "whale" },
      "side": "sell",
      "token": { "id": "9BEc...A2D", "symbol": "jlUSDC" },
      "amount": 23531452.15,
      "priceUsd": 1.062,
      "valueUsd": 24994767.31,
      "solAmount": 211807.91,
      "pnlUsd": 925.74, // realized PnL on sells; null on buys
      "signature": "23Z7...hL"
    }
  ],
  "next": "451986027000557000" // null on the last page
}
```

## Workflows

### Find a token, vet it, then watch it

```bash
jup spot tokens --list trending --interval 1h
jup spot token info --token <mint>
jup spot token holders --token <mint> --tag bundler
jup spot watchlist add --token <mint>
```

### Copy what Smart Money is buying

```bash
jup spot smart-money summary --side buy
jup spot smart-money wallets --category smart --interval 7d
jup spot tracker add --address <address>
jup spot tracker trades
```
