# Gacha

Collector Crypt gacha packs, pulled cards, the card marketplace and physical redemption. Reads need no key; writes need an active key. See [setup](setup.md).

Phygitals and Beezie packs aren't available: jup.ag serves them from a gacha-only API that rejects other API keys.

## Packs

### Browse packs

```bash
jup gacha packs
jup gacha packs --pack pokemon_50
jup gacha packs --pack pokemon_50 --limit 20
```

- Lists the packs shown on jup.ag, cheapest first.
- `--pack` shows one pack's rarity tiers and a page of the cards it can pull (`--limit`, default 10).
- `oddsPct` is a percentage (`80` means 80%); `buybackPct` is the share of a card's value paid on instant buyback.

```js
// Example JSON response (--pack):
{
  "pack": {
    "pack": "pokemon_50",
    "name": "Elite Pokémon Gacha Pack",
    "category": "Pokemon",
    "priceUsd": 50,
    "evUsd": 54.71, // expected card value per pull
    "buybackPct": 85,
    "cardsPerPack": 1,
    "turbo": true, // supports --turbo
    "inStock": true,
    "tiers": [
      { "rarity": "common", "oddsPct": 80, "minValueUsd": 30, "maxValueUsd": 60, "stock": 105 }
    ],
    "cards": [
      { "mint": "HpEy...WBxd", "name": "2013 #120 Garchomp PSA 9 Black &", "rarity": "epic", "grade": "PSA MINT 9", "valueUsd": 3900 }
    ]
  }
}
```

### Open packs

```bash
jup gacha open --pack pokemon_50
jup gacha open --pack pokemon_50 --quantity 3 --turbo
jup gacha open --pack pokemon_50 --gifted
jup gacha open --pack pokemon_50 --memo <memo>
```

- Buys and opens packs, paying in USDC. `--quantity` buys 1-10 packs (default 1), one transaction each, built and signed right before it is submitted.
- `--turbo` instantly sells commons back for USDC (`result: "buyback"`).
- `--gifted` opens packs you were gifted or won (see `gacha collection` for counts). It signs a message instead of a transaction.
- `--memo` opens a pack that was paid for but not opened. It can't be combined with `--quantity` or `--gifted`.
- Packs are bought and opened one at a time. If one fails, the command stops, prints the pulls that completed, and exits with code 1. JSON output then adds `failed`: `stage` is `"buy"` (nothing paid for that pack), `"submit"` (signed, payment unknown: check `signature`) or `"open"` (paid, or the gifted pack used, but not opened); `retry` is the `--memo` command for that pack; `packsNotOpened` counts the packs after it, which were not bought and are safe to rerun.
- `--dry-run` returns the unsigned purchase `transactions` and their `memos` without paying.

```js
// Example JSON response:
{
  "pack": "pokemon_50",
  "address": "5tzF...uAi9",
  "pulls": [
    {
      "memo": "jupiter-7f710157-e8a5-4496-9d54-b3255ce1cd6a",
      "result": "card", // "card" (kept) or "buyback" (sold by --turbo)
      "card": { "mint": "TyEu...L6w", "name": "2019 #157 Reshiram & Zekrom GX", "rarity": "rare", "grade": "PSA GEM-MT 10", "valueUsd": 122 },
      "buybackUsd": null,
      "signature": "5ZQm..."
    }
  ]
  // Only after a failure:
  // "failed": { "stage": "open", "memo": "jupiter-...", "signature": "3Lx...", "error": "...", "retry": "jup gacha open --pack pokemon_50 --memo jupiter-...", "packsNotOpened": 1 }
}
```

### Gift packs

```bash
jup gacha gift --pack pokemon_50 --to <wallet-address>
jup gacha gift --pack pokemon_50 --to <wallet-address> --quantity 5
```

- You pay for 1-20 packs; the recipient opens them with `gacha open --gifted`.

```js
// Example JSON response:
{
  "giftId": "24723",
  "pack": "pokemon_50",
  "quantity": 1,
  "from": "5tzF...uAi9",
  "to": "BQ72...GQDV",
  "costUsd": 50,
  "signature": "3nVb..."
}
```

### Sell a pull back

```bash
jup gacha buyback --mint <card-mint>
```

- Sells a recently pulled card back for USDC (`amountUsd`). Only cards still in their buyback window have an offer.

```js
// Example JSON response:
{
  "mint": "Fr72...zcZN",
  "address": "HDef...qUs7",
  "amountUsd": 27.2,
  "signature": "2kq8..."
}
```

## Collection and activity

### View a collection

```bash
jup gacha collection
jup gacha collection --address <wallet-address>
```

- With no options, uses the active key's wallet. `--key` and `--address` are mutually exclusive.
- `packs` lists unopened gifted or won packs.

```js
// Example JSON response:
{
  "address": "AR77...Zzvn",
  "cardCount": 10,
  "insuredValueUsd": 13274,
  "cards": [
    {
      "mint": "7KVL...Kb4C",
      "cardId": "2026092041C261249",
      "name": "2024 #156 Future Potential! PSA 10 Digimon Promos",
      "category": "Collectible Card Games",
      "grade": "PSA GEM-MT 10",
      "insuredValueUsd": 1300,
      "status": "unlisted", // "listed", "unlisted" or "shipping"
      "price": null, // list price when listed
      "currency": null,
      "marketplace": null,
      "listedAt": null
    }
  ],
  "packs": [{ "pack": "pokemon_50", "count": 1 }]
}
```

### View activity

```bash
jup gacha activity
jup gacha activity --address <wallet-address> --limit 50
```

- `pulls` are pack openings (newest first); `trades` are marketplace events. `--limit` applies to each list (default 20).
- `memo` identifies a pull for `gacha verify`.

```js
// Example JSON response:
{
  "address": "ERp9...DjQ9",
  "pulls": [
    {
      "memo": "cc-4392e287-6278-4ec1-9640-12ba1a8ecbd8",
      "at": "2026-09-30T21:03:54.170Z",
      "costUsd": 25,
      "status": "confirmed",
      "mint": "CBg5...pDA",
      "name": "2024 #093 Umbreon EX PSA 10 Japa",
      "roll": 11339845,
      "buybackUsd": null, // USDC received if the pull was sold back
      "signature": "3uWx..."
    }
  ],
  "trades": [
    {
      "action": "buyNow", // buyNow, bid, list, delist
      "mint": "FKkT...BwE",
      "name": "2023 #GG07 Full Art/Keldeo PSA 10",
      "priceUsd": 220, // null when the venue reported no USDC price
      "from": "Fjqn...sjLM",
      "to": "ERp9...DjQ9",
      "signature": "2BN5...vsT",
      "at": "2026-09-28T09:58:02.000Z"
    }
  ]
}
```

### Verify a pull

```bash
jup gacha verify --memo <memo>
```

Recomputes the pull's VRF proof. `valid` is true only when every check passes.

```js
// Example JSON response:
{
  "memo": "cc-4392e287-6278-4ec1-9640-12ba1a8ecbd8",
  "valid": true,
  "rollMatches": true,
  "actualRoll": 9777113,
  "calculatedRoll": 9777113,
  "address": "AR77...Zzvn",
  "mint": "CpfR...Rgjh",
  "card": "2026 #248 Ezreal - Prodigal Expl",
  "turbo": null,
  "algorithm": "ECVRF-EDWARDS25519-SHA512-TAI",
  "vrfMode": 1,
  "publicKey": "0x115c...cb83",
  "proof": "0x0fdc...",
  "signature": "2BHm...ff8u"
}
```

### Recent pulls

```bash
jup gacha winners
jup gacha winners --pack pokemon_50 --epic --limit 50
```

```js
// Example JSON response:
{
  "winners": [
    {
      "address": "Gvup...nBj6",
      "pack": "basketball_100",
      "mint": "GNdG...faBe",
      "name": "2024 #27 Isaiah Evans PSA 10 Bow",
      "rarity": "common",
      "valueUsd": 72,
      "openedAt": "2026-10-01T00:35:23.531Z"
    }
  ]
}
```

### Weekly leaderboard

```bash
jup gacha leaderboard
jup gacha leaderboard --season 3 --limit 50
jup gacha leaderboard --address <wallet-address>
```

- Defaults to the current week, else the latest finished one. `seasons` lists every week.
- `--key` or `--address` adds that wallet's standing as `me`; `claimState` is `locked`, `available`, `delivering`, `delivered` or `retryable`.

```js
// Example JSON response:
{
  "season": {
    "season": 4,
    "state": "completed", // pending, ongoing, completed
    "startAt": "2026-08-03T00:00:00.000Z",
    "endAt": "2026-08-10T00:00:00.000Z",
    "minVolumeUsd": 1000,
    "prizes": [{ "fromRank": 1, "toRank": 1, "pack": "pokemon_2500", "packs": 1 }]
  },
  "seasons": [{ "season": 1, "state": "completed", "startAt": "2026-07-13T00:00:00.000Z", "endAt": "2026-07-20T00:00:00.000Z" }],
  "entries": [
    { "rank": 1, "address": "FjNc...udR", "volumeUsd": 426150, "prize": { "pack": "pokemon_2500", "packs": 1 } }
  ],
  "me": {
    "address": "FjNc...udR",
    "entry": { "rank": 1, "address": "FjNc...udR", "volumeUsd": 426150, "prize": { "pack": "pokemon_2500", "packs": 1 } },
    "claimState": "delivered"
  }
}
```

## Marketplace

### Search listings

```bash
jup gacha marketplace
jup gacha marketplace --search Pikachu --sort list-price-asc
jup gacha marketplace --category Pokemon --grading-company PSA,CGC --min-grade 9 --max-price 100
jup gacha marketplace --limit 50 --page 2
```

- `--sort`: `list-date-desc` (default), `list-date-asc`, `list-price-asc`, `list-price-desc`, `insured-asc`, `insured-desc`, `name-asc`, `name-desc`, `year-asc`, `year-desc`, `newest`, `oldest`
- `--category` and `--grading-company` take comma-separated lists.
- `price` is in `currency` (`USDC`, or `SOL` for some Magic Eden listings).

```js
// Example JSON response:
{
  "total": 6054,
  "page": 1,
  "totalPages": 303,
  "listings": [
    {
      "mint": "D5i9...sFysoS",
      "cardId": "2026090221C240266",
      "name": "2022 #265 Full Art/Pikachu Vmax PSA 8 Japanese S Promo",
      "category": "Pokemon",
      "grade": "PSA NM-MT 8",
      "insuredValueUsd": 28,
      "status": "listed",
      "price": 28,
      "currency": "USDC",
      "marketplace": "CC", // CC (Collector Crypt) or ME (Magic Eden)
      "owner": "ERp9...DjQ9",
      "listedAt": "2026-09-28T05:07:07.456Z"
    }
  ]
}
```

### View a card

```bash
jup gacha card --mint <card-mint>
```

Returns the listing fields above plus `year`, `set`, `gradingId`, `frontImage` and `backImage`.

### Buy, list and delist

```bash
jup gacha buy --mint <card-mint>
jup gacha list --mint <card-mint> --price 120
jup gacha delist --mint <card-mint>
```

- `buy` pays the current list price.
- `list` lists a card you own for `--price` USDC, or changes the price if it's already listed (`action: "update"`).
- `--dry-run` returns the unsigned `transactions` without signing or broadcasting.

```js
// Example JSON response:
{
  "action": "buy", // buy, list, update, delist
  "mint": "D5i9...sFysoS",
  "name": "2022 #265 Full Art/Pikachu Vmax PSA 8 Japanese S Promo",
  "price": 28,
  "currency": "USDC",
  "seller": "ERp9...DjQ9",
  "signature": "4tQx..."
}
```

## Shipping

Shipping uses a Collector Crypt session: each command signs a sign-in message with your key (no transaction).

### View addresses and shipments

```bash
jup gacha shipping
jup gacha shipping --shipment <id>
```

```js
// Example JSON response:
{
  "address": "Fvp...tEi9",
  "addresses": [
    { "id": "addr_1", "name": "Jane Doe", "city": "Austin", "state": "TX", "country": "US", "isDefault": true }
  ],
  "shipments": [
    {
      "id": "shp_1",
      "reference": "CC-1042",
      "status": "Shipped",
      "cardCount": 2,
      "carrier": "FedEx",
      "trackingIds": ["7712..."],
      "trackingUrls": ["https://..."],
      "totalCostUsd": 31.5,
      "createdAt": "2026-09-20T10:00:00.000Z"
    }
  ]
}
```

### Ship cards

```bash
jup gacha ship --mint <card-mint> <card-mint> --address-id <id>
```

- Burns the card NFTs and creates a delivery order to a saved address. Add addresses on jup.ag.
- Collector Crypt insures shipments over $5,000 automatically; there is no insurance option.
- If signing or submitting fails after the order is prepared, the error includes the `shipmentId` to give Collector Crypt support.
- `--dry-run` returns the cost quote only (`shippingUsd`, `insuranceUsd`, `feesUsd`, `totalUsd`): preparing the order would open it with Collector Crypt, so no transaction is built.

```js
// Example JSON response:
{
  "mints": ["CaC3...t2Yo"],
  "addressId": "addr_1",
  "cardCount": 1,
  "shippingUsd": 25,
  "insuranceUsd": null,
  "feesUsd": 5,
  "totalUsd": 30,
  "shipmentId": "shp_2",
  "status": "PaymentReceived"
}
```
