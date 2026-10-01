# Prediction Markets

Requires: an active key for trading commands (`open`, `close`, `claim`, `arcade open`) and for signed community actions (`clans` writes, `comments` writes, `set-username`). Reads accept `--address` for any wallet. See [setup](setup.md).

Every write honors `--dry-run`. Transaction writes return the unsigned base64 `transaction` without signing or submitting. Signed-message writes (clans, comments, username) return the `message` the wallet would sign and submit nothing.

## Commands

### Browse events

```bash
jup predictions events
jup predictions events --filter trending
jup predictions events --category crypto --sort volume
jup predictions events --category sports --subcategory nfl,nba
jup predictions events --category crypto --tags bitcoin
jup predictions events --search "bitcoin"
jup predictions events --id <eventId>
jup predictions events --id <eventId>,<eventId>
jup predictions events --limit 5 --offset 10
```

- `--filter`: `new`, `live`, `trending`
- `--sort`: `volume`, `volume24h` (default), `recent`
- `--category`: `all` (default), `crypto`, `sports`, `politics`, `esports`, `culture`, `economics`, `tech`
- `--subcategory`, `--tags`: comma-separated IDs from `jup predictions categories`
- `--id` takes one or more comma-separated event IDs; it cannot be combined with listing or search options
- `--search` cannot be combined with `--filter`, `--sort`, `--category`, `--subcategory`, `--tags`, or `--offset`

```js
// Example JSON response:
{
  "events": [
    {
      "eventId": "abc123",
      "title": "Will BTC hit $200k by end of 2026?",
      "category": "crypto",
      "isLive": true,
      "volumeUsd": 125000.50,
      "volume24hUsd": 123.32,
      "startsAt": "2026-01-01T00:00:00.000Z",
      "endsAt": "2026-12-31T23:59:59.000Z",
      "markets": [
        {
          "marketId": "mkt456",
          "title": "Yes / No",
          "status": "open",
          "provider": "polymarket", // kalshi, polymarket, gx (Saba), bisonfi
          "rulesPrimary": "Resolves to Yes if BTC trades at or above $200,000 before 2027-01-01 UTC.",
          "rulesSecondary": "Resolution uses the exchange and settlement source named in the market rules.",
          "yesPriceUsd": 0.65, // 65% implied probability; null when no liquidity
          "noPriceUsd": 0.35,
          "result": null // "yes" or "no" when resolved
        }
      ]
    }
  ],
  "next": 10 // pagination offset for next page; omitted when no more results
}
```

### Categories, tags, and suggestions

```bash
jup predictions categories
jup predictions categories --category crypto   # adds the category's tags
jup predictions suggested --limit 5
jup predictions suggested --category sports --exclude <eventId>
```

```js
// Example JSON response (categories --category crypto):
{
  "categories": [
    {
      "category": "crypto",
      "eventCount": 740,
      "subcategories": [
        { "subcategory": "btc", "label": "Bitcoin", "eventCount": 99 }
        // children: [...] for nested subcategories (e.g. soccer leagues)
      ]
    }
  ],
  "tags": [{ "label": "Bitcoin", "tag": "bitcoin", "eventCount": 50 }]
}
```

`suggested` returns the same `{ "events": [...] }` shape as `events`.

### Market detail, price history, orderbook, and scores

```bash
jup predictions market --id <marketId>
jup predictions price-history --market <marketId> --limit 50
jup predictions orderbook --market <marketId> --depth 10
jup predictions score --event <eventId>
```

- `orderbook` reads one snapshot from Jupiter's price WebSocket (needs Node.js 22+ or the standalone binary)
- `score` returns `"score": null` when the event has no live sports score

```js
// Example JSON response (market):
{
  "marketId": "POLY-1357374",
  "title": "Buffalo Bills",
  "provider": "polymarket",
  "status": "open",
  "result": null,
  "yesPriceUsd": 0.14, // buy prices
  "noPriceUsd": 0.87,
  "yesSellPriceUsd": 0.13, // best bids
  "noSellPriceUsd": 0.86,
  "options": [{ "label": "Yes", "buyYes": true }, { "label": "No", "buyYes": false }],
  "limitOrders": true, // limit buys are supported on Polymarket markets
  "opensAt": "2026-02-09T00:42:08.000Z",
  "closesAt": "2027-04-01T03:59:00.000Z",
  "resolvesAt": null,
  "rulesPrimary": "This market will resolve according to ...",
  "rulesSecondary": ""
}

// Example JSON response (price-history):
{
  "marketId": "POLY-1357374",
  "history": [{ "time": "2026-10-01T00:10:17.000Z", "probabilityPct": 14.5 }]
}

// Example JSON response (orderbook):
{
  "marketId": "POLY-1357374",
  "yes": {
    "bestBidUsd": 0.13,
    "bestAskUsd": 0.14,
    "bids": [{ "priceUsd": 0.13, "contracts": 401182.24 }],
    "asks": [{ "priceUsd": 0.14, "contracts": 22775.99 }]
  },
  "no": { "bestBidUsd": 0.86, "bestAskUsd": 0.87, "bids": [...], "asks": [...] }
}

// Example JSON response (score):
{
  "eventId": "POLY-1081044",
  "score": {
    "eventId": "POLY-1081044",
    "league": "WNBA",
    "homeTeam": "Atlanta Dream",
    "awayTeam": "Washington Mystics",
    "score": "54-48",
    "period": "Q3",
    "elapsed": "04:12",
    "status": "inprogress",
    "live": true,
    "ended": false
  }
}
```

### Timed up/down markets

```bash
jup predictions timed --asset btc
jup predictions timed --asset sol --interval 5m --limit 5
jup predictions timed --asset spcx --interval 15m
```

- `--asset`: `btc`, `eth`, `sol`, `xrp`, `bnb`, `doge`, `hype`, `spcx` (stock)
- `--interval`: `5m`, `15m` (default), `1H`, `4h`, `daily`, `weekly`, `monthly`, `yearly`
- Each event has an "Up" and a "Down" market; buy one with `jup predictions open --market <marketId> --side yes`

```js
// Example JSON response:
{
  "asset": "btc",
  "interval": "15m",
  "priceToBeatUsd": 83457.73, // asset price when the live window opened; null if unavailable
  "current": { /* event, same shape as in events */ },
  "upcoming": [ /* events, soonest first */ ],
  "recent": [ /* events, newest first; the winning market has result "yes" */ ]
}
```

### Latest trades

```bash
jup predictions trades --limit 20
```

```js
// Example JSON response:
{
  "count": 1,
  "trades": [
    {
      "time": "2026-10-01T00:18:55.000Z",
      "address": "Ftti...SgYa",
      "event": "Boston Red Sox vs. New York Yankees",
      "market": "New York Yankees",
      "eventId": "POLY-1090001",
      "marketId": "POLY-4990001-0",
      "action": "buy",
      "side": "yes",
      "amountUsd": 115.33,
      "priceUsd": 0.59
    }
  ]
}
```

### View positions

```bash
jup predictions positions
jup predictions positions --key mykey
jup predictions positions --address <wallet-address>
jup predictions positions --position <pubkey>
```

- With no options, uses the active key's wallet
- `--position` looks up a single position by pubkey; cannot be combined with `--key` or `--address`

```js
// Example JSON response:
{
  "count": 2,
  "positions": [
    {
      "positionPubkey": "3qMZ...83tz",
      "event": "Will BTC hit $200k by end of 2026?",
      "market": "Yes / No",
      "side": "yes",
      "contracts": 10,
      "costUsd": 6.50,
      "valueUsd": 7.20,
      "pnlUsd": 0.70,
      "pnlPct": 10.77, // percentage; 10.77 means +10.77%
      "startsAt": "2026-01-01T00:00:00.000Z",
      "endsAt": "2026-12-31T23:59:59.000Z",
      "claimable": false // true when market resolved in your favor
    }
  ]
}
```

### Open a position

```bash
jup predictions open --market <marketId> --side yes --amount 10
jup predictions open --market <marketId> --side no --amount 5 --input USDC
jup predictions open --market <marketId> --side y --amount 10 --limit 0.42
jup predictions open --market <marketId> --side yes --amount 500 --slippage 700
jup predictions open --market <marketId> --side yes --amount 10 --dry-run
```

- `--market`: market ID from `jup predictions events`
- `--side`: `yes`, `no`, `y`, `n`
- `--amount`: input token amount (human-readable)
- `--input`: input token symbol or mint (default: `USDC`); timed stock (BisonFi) markets accept USDC only
- `--limit`: place a limit buy at this max price per contract in USD (between 0 and 1). Polymarket markets only
- `--slippage`: accept the server's simulated slippage up to this many bps. The server quotes `slippageBps` for every order and caps it at `maxSlippageBps` (the order reverts above it). Like jup.ag's confirmation prompt, a quote of 500 bps (5%) or more is refused unless `--slippage` is at or above it; this also applies under `--dry-run`
- Saba (`gx`) markets are bought as tickets and only support `--side yes`
- Kalshi buys are currently disabled by the API; Kalshi positions can still be closed and claimed
- After submitting a market order, the CLI waits up to 60 seconds for the keeper to fill it and reports `orderStatus`: `filled`, `failed`, or `pending` (still unfilled when the wait ended). Limit orders get a 15-second check, since a marketable limit can fill at once; otherwise they report `pending` and rest until filled or cancelled
- A `failed` order (the keeper rejected it) exits non-zero; the JSON response still carries the order details plus an `error`. `pending` exits 0
- `--dry-run` previews the order without signing, showing cost, fees, and payout. JSON response includes the unsigned base64 `transaction`

```js
// Example JSON response:
{
  "action": "open",
  "marketId": "mkt456",
  "side": "yes",
  "orderType": "market", // "limit" with --limit; "ticket" on Saba markets
  "limitPriceUsd": null,
  "contracts": 10,
  "costUsd": 6.50,
  "feeUsd": 0.07,
  "maxBuyPriceUsd": 0.72, // on-chain price cap the server set for the order
  "slippageBps": 14, // simulated slippage the server quoted
  "maxSlippageBps": 2500, // the order reverts above this
  "positionAvgPriceUsd": 0.65,
  "positionPayoutUsd": 10.00,
  "positionPubkey": "3qMZ...83tz",
  "orderPubkey": "BMbi...NMxW",
  "orderStatus": "filled", // null in dry-run
  "filledContracts": 10,
  "avgFillPriceUsd": 0.65,
  "signature": "2Goj...diEc"
}
```

### Close, claim, or cancel

```bash
# Sell a whole position
jup predictions close --position <pubkey>

# Sell part of a position
jup predictions close --position <pubkey> --contracts 25

# Claim a resolved position (market settled in your favor)
jup predictions close --position <pubkey>

# Sell all open positions
jup predictions close --position all

# Cancel a resting limit order
jup predictions close --order <orderPubkey>

# Dry-run
jup predictions close --position <pubkey> --dry-run
```

- The CLI auto-detects whether to sell or claim based on the market result
- Like jup.ag, full sells ask for a floor $0.02 under the current bid (never below $0.01), but the server sets the on-chain floor itself: `minSellPriceUsd` in the response, up to `maxSlippageBps` under the bid. Check it in the `--dry-run` preview
- `--slippage <bps>` works as on `open`: a quote of 500 bps or more, or slippage that would cost $2,000 or more of the sale, is refused unless `--slippage` is at or above `slippageBps`
- `--contracts` rounds down to the venue's step (1 contract on Kalshi, 0.01 on Polymarket)
- Saba (`gx`) positions can't be sold, fully or partly; hold them until the market resolves, then claim
- Sells wait for the fill and report `orderStatus`, like `open`; a `failed` sell exits non-zero
- `--dry-run` previews without signing. JSON response includes the unsigned base64 `transaction`

```js
// Example JSON response (close):
{
  "action": "close",
  "event": "Will BTC hit $200k by end of 2026?",
  "market": "Yes / No",
  "side": "yes",
  "positionPubkey": "3qMZ...83tz",
  "partial": false,
  "contracts": 10,
  "costUsd": 0, // always 0 for sells
  "feeUsd": 0.07,
  "sellPriceUsd": 0.72, // current bid
  "proceedsUsd": 7.20, // expected: contracts × sellPriceUsd, before fees
  "minSellPriceUsd": 0.54, // on-chain floor the server set
  "slippageBps": 14,
  "maxSlippageBps": 2500,
  "orderPubkey": "2pf8...N33a",
  "orderStatus": "filled",
  "filledContracts": 10,
  "avgFillPriceUsd": 0.72,
  "signature": "5YhT...9AKU"
}

// Example JSON response (claim):
{
  "action": "claim",
  "event": "Will BTC hit $200k by end of 2026?",
  "market": "Yes / No",
  "side": "yes",
  "positionPubkey": "3qMZ...83tz",
  "contracts": 10,
  "payoutUsd": 10.00,
  "signature": "4xK2...9zH1"
}

// Example JSON response (close all):
{
  "action": "close-all",
  "results": [
    {
      "action": "close", // or "claim"
      "positionPubkey": "3qMZ...83tz",
      "signature": "5YhT...9AKU"
    }
  ]
}

// Example JSON response (cancel):
{
  "action": "cancel",
  "orderPubkey": "BJSf...gpiG",
  "signature": "3kQe...7pLm"
}
```

### Claim payouts

```bash
jup predictions claim                       # every claimable position
jup predictions claim --position <pubkey>   # one position
jup predictions claim --dry-run
```

```js
// Example JSON response:
{
  "action": "claim",
  "payoutUsd": 243.49,
  "results": [
    {
      "positionPubkey": "3dFp...ugfW",
      "side": "yes",
      "contracts": 128,
      "payoutUsd": 128.93,
      "signature": "4xK2...9zH1"
    }
  ]
}
```

### View orders

```bash
jup predictions orders
jup predictions orders --address <wallet-address> --limit 20
```

```js
// Example JSON response:
{
  "count": 1,
  "orders": [
    {
      "orderPubkey": "BJSf...gpiG",
      "event": "NFL Champion 2027",
      "market": "Buffalo Bills",
      "marketId": "POLY-1357374",
      "orderType": "limit", // or "market"
      "status": "pending", // "filled" or "failed"
      "side": "yes",
      "action": "buy", // or "sell"
      "contracts": 500,
      "filledContracts": 0,
      "limitPriceUsd": 0.01, // max buy or min sell price
      "avgFillPriceUsd": null,
      "sizeUsd": 5,
      "positionPubkey": "9hQh...PpViM",
      "createdAt": "2026-10-01T00:00:00.000Z"
    }
  ],
  "next": 10 // omitted when no more results
}
```

### View trade history

```bash
jup predictions history
jup predictions history --key mykey
jup predictions history --address <wallet-address>
jup predictions history --limit 5 --offset 10
```

- With no `--address` or `--key`, uses the active key's wallet
- `--limit` defaults to 10
- `--offset` is used for pagination; use the `next` value from the previous response to fetch the next page

```js
// Example JSON response:
{
  "count": 15,
  "history": [
    {
      "time": "2026-03-15T10:30:00.000Z",
      "event": "Will BTC hit $200k by end of 2026?",
      "market": "Yes / No",
      "type": "order_filled", // event type
      "side": "yes",
      "action": "buy", // or "sell"
      "contracts": 10,
      "avgPriceUsd": 0.65,
      "pnlUsd": 0.70, // null for buys
      "payoutUsd": 0,
      "positionPubkey": "3qMZ...83tz",
      "signature": "2Goj...diEc"
    }
  ],
  "next": 10 // pagination offset for next page; omitted when no more results
}
```

### Profiles, PnL, and leaderboard

```bash
jup predictions profile --address <wallet-address> --period 30d
jup predictions pnl --address <wallet-address> --interval 7d
jup predictions leaderboard --period weekly --metric pnl --limit 10
jup predictions set-username --username <name>
```

- `profile --period`: `all_time` (default), `24h`, `7d`, `30d`
- `pnl --interval`: `24h`, `7d` (default), `30d`, `all`
- `leaderboard --period`: `all_time`, `weekly` (default), `monthly`; `--metric`: `pnl` (default), `volume`, `win_rate`
- `set-username` signs a message with your wallet; `--dry-run` shows the message

```js
// Example JSON response (profile):
{
  "address": "DVHD...ksdT",
  "username": null,
  "period": "all_time",
  "pnlUsd": -22472.22,
  "volumeUsd": 1320127.67,
  "predictions": 173,
  "correct": 138,
  "wrong": 35,
  "winRatePct": 79.77,
  "activeContracts": 3584.71,
  "positionsValueUsd": 2949.6
}

// Example JSON response (pnl):
{
  "address": "DVHD...ksdT",
  "interval": "7d",
  "bucketSeconds": 21600,
  "changeUsd": 643.38,
  "history": [{ "time": "2026-09-24T00:00:00.000Z", "pnlUsd": -23190.95 }]
}

// Example JSON response (leaderboard):
{
  "period": "weekly",
  "metric": "pnl",
  "totalVolumeUsd": 467325.6,
  "totalPredictions": 4618,
  "leaderboard": [
    {
      "rank": 1,
      "address": "E1Uc...zeHm",
      "username": null,
      "pnlUsd": 36202.77,
      "volumeUsd": 36755.51,
      "predictions": 2,
      "correct": 2,
      "wrong": 0,
      "winRatePct": 100
    }
  ]
}

// Example JSON response (set-username):
{ "action": "set-username", "address": "GuP8...6dc", "username": "arcader" }
```

### Arcade (1-minute rounds)

```bash
jup predictions arcade rounds --asset BTC
jup predictions arcade open --asset SOL --side up --amount 5
jup predictions arcade positions
jup predictions arcade history --address <wallet-address> --limit 20
```

- Rounds last 60 seconds. Bets go into the next round and pay out automatically after it settles
- `--side`: `up`, `down`, `u`, `d`; `--amount` is in USDC
- If betting has just closed for the next round, `open` waits a few seconds and retries once

```js
// Example JSON response (rounds):
{
  "asset": "BTC",
  "paused": false,
  "roundSeconds": 60,
  "betCutoffSeconds": 3,
  "feePct": 1,
  "minBetUsd": 1,
  "maxBetUsd": 1000,
  "live": {
    "roundId": "btc-1790813280",
    "address": "6wct...cgP",
    "opensAt": "2026-10-01T00:21:00.000Z",
    "closesAt": "2026-10-01T00:22:00.000Z",
    "status": "live", // betting, live, resolving, settled, voided, upcoming
    "outcome": null, // "UP", "DOWN", or "VOID" once settled
    "upPoolUsd": 262,
    "downPoolUsd": 250,
    "openPriceUsd": 83445.17,
    "closePriceUsd": null
  },
  "next": { /* round */ },
  "recent": [ /* rounds, newest first */ ]
}

// Example JSON response (open):
{
  "action": "open",
  "asset": "BTC",
  "side": "up",
  "amountUsd": 5,
  "roundOpensAt": "2026-10-01T00:22:00.000Z",
  "signature": "3Hk1...Qe9x"
}

// Example JSON response (history):
{
  "address": "GuP8...6dc",
  "totalRounds": 2529,
  "wins": 1195,
  "losses": 1278,
  "voided": 54,
  "pnlUsd": 254.71,
  "history": [
    {
      "asset": "BTC",
      "opensAt": "2026-10-01T00:18:00.000Z",
      "outcome": "DOWN",
      "side": "down", // up, down, or both
      "amountUsd": 1,
      "payoutUsd": 1.96,
      "pnlUsd": 0.96,
      "roundAddress": "Humpk...iShg"
    }
  ],
  "next": 20
}
```

`arcade positions` returns `{ "address", "count", "positions": [{ "asset", "round": "live" | "next", "opensAt", "closesAt", "upAmountUsd", "downAmountUsd", "upPayoutUsd", "downPayoutUsd" }] }`.

### Clans

```bash
# Read
jup predictions clans list --search degen --limit 20
jup predictions clans list --address <wallet-address>   # the clan this wallet is in
jup predictions clans get --clan <clanId|handle>
jup predictions clans rankings
jup predictions clans rankings --week 2026-09-21

# Signed with your wallet
jup predictions clans invites                           # invitations you received
jup predictions clans create --name "Arcaders" --handle arcaders --description "gm"
jup predictions clans join --clan <clanId|handle>
jup predictions clans leave --clan <clanId|handle>
jup predictions clans accept --clan <clanId|handle> --invite <inviteId>
# Clan leaders
jup predictions clans invite --clan <clanId|handle> --member <wallet-address>
jup predictions clans revoke --clan <clanId|handle> --invite <inviteId>
jup predictions clans approve --clan <clanId|handle> --request <requestId>
jup predictions clans reject --clan <clanId|handle> --request <requestId>
jup predictions clans kick --clan <clanId|handle> --member <wallet-address>
```

- Clan actions are authorized by a signed message, not a transaction. With `--dry-run` they print the message and submit nothing

```js
// Example JSON response (get):
{
  "clanId": "3cfb1fe7-6598-4cef-bd9b-bdf2b992c388",
  "name": "Arcaders",
  "handle": "arcaders",
  "description": null,
  "leader": "GuP8...6dc",
  "memberCount": 48,
  "createdAt": "2026-09-02T12:41:26.053Z",
  "members": [{ "address": "GuP8...6dc", "role": "leader", "joinedAt": "2026-09-02T12:41:26.053Z" }],
  "invites": [{ "inviteId": "...", "address": "...", "invitedBy": "...", "expiresAt": null }],
  "joinRequests": [{ "requestId": "...", "address": "...", "createdAt": "..." }]
}

// Example JSON response (rankings):
{
  "competitionId": "be8f1adc-1998-4701-8087-f183ed52cf54",
  "startsAt": "2026-09-28T00:00:00.000Z",
  "endsAt": "2026-10-05T00:00:00.000Z",
  "minVolumeUsd": 10000,
  "status": "open",
  "rankings": [
    {
      "rank": 1, // null until the clan qualifies
      "clanId": "416b0b44-...",
      "name": "wta picks",
      "handle": "wta-picks",
      "pnlUsd": 4742.25,
      "volumeUsd": 56276.66,
      "qualified": true,
      "memberCount": 13
    }
  ]
}

// Example JSON response (join, --dry-run):
{
  "dryRun": true,
  "action": "join",
  "clanId": "707e64d1-5a86-4178-a1d0-bc2639430aed",
  "address": "GuP8...6dc",
  "message": "Jupiter Prediction Market Clans\nAction: Request to join clan\nClan: JupCallers\nClanId: 707e...\nWallet: GuP8...6dc\nTimestamp: 2026-10-01T00:21:39.778Z",
  "request": { "path": "clans/707e.../join-requests", "body": {} }
}

// Example JSON response (join):
{ "action": "join", "clanId": "707e...", "result": { /* join request from the API */ } }
```

`clans list` returns `{ "totalClans", "totalMembers", "clans": [{ "clanId", "name", "handle", "description", "leader", "memberCount", "createdAt" }], "next" }`. `clans invites` returns `{ "address", "count", "invites": [{ "inviteId", "clanId", "clan", "handle", "invitedBy", "expiresAt" }] }`.

### Comments

```bash
jup predictions comments list --event <eventId> --sort top
jup predictions comments list --arcade
jup predictions comments list --clan <clanId|handle>       # clan members only; signs with your key
jup predictions comments list --subcategory nfl --cursor <cursor>
jup predictions comments post --event <eventId> --text "Bills in 4"
jup predictions comments post --arcade --text "gm" --reply <commentId>
jup predictions comments like --comment <commentId>
jup predictions comments like --comment <commentId> --unlike
jup predictions comments delete --comment <commentId>
```

- Threads are per event subcategory (timed events add their timeframe), the arcade chat, or a clan chat
- `--sort`: `newest` (default), `oldest`, `top`
- Writes authorize a 24-hour comment session by signing one message with your wallet, then sign the comment with that session key. `--dry-run` prints the wallet message and submits nothing

```js
// Example JSON response (list):
{
  "subcategory": "nfl",
  "tags": [],
  "comments": [
    {
      "commentId": "ea245bde-92ba-4e2b-978f-b41f03416e25",
      "address": "BFaJ...2WrL",
      "text": "Seahawks and 49ers for me",
      "likes": 0,
      "likedByMe": false,
      "createdAt": "2026-09-27T17:08:59.780Z",
      "replies": []
    }
  ],
  "next": "2026-09-27T15:15:03.427Z|f20e..." // pass as --cursor; null on the last page
}

// Example JSON response (post):
{ "action": "comment", "commentId": "...", "address": "...", "text": "gm", "likes": 0, "likedByMe": false, "createdAt": "...", "replies": [] }
```

## Workflows

### Browse events then open a position

```bash
jup predictions events --category crypto
# Find the market ID from the output
jup predictions open --market <marketId> --side yes --amount 10
```

### Place and cancel a limit buy

```bash
jup predictions open --market <marketId> --side yes --amount 10 --limit 0.40
jup predictions orders
jup predictions close --order <orderPubkey>
```

### Check positions then close

```bash
jup predictions positions
# Copy the positionPubkey
jup predictions close --position <pubkey> --contracts 5   # sell 5 contracts
jup predictions close --position <pubkey>                 # sell the rest
```

### Claim resolved positions

```bash
jup predictions positions
# Positions with "claimable: true" can be claimed
jup predictions claim
```

### Trade the next 15-minute BTC window

```bash
jup predictions timed --asset btc --interval 15m
# Pick the "Up" or "Down" market of the upcoming event
jup predictions open --market <marketId> --side yes --amount 5
```
